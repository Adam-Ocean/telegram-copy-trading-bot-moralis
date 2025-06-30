// src/services/positionTracker.js
const Swap = require("../db/models/swaps");
require("dotenv").config();

/**
 * Tracks token positions and determines swap types for ratio-based copy trading
 */

/**
 * Detect if a swap is an entry (new position) or exit (selling existing position)
 * @param {Object} swap - The swap data from Moralis
 * @param {string} walletAddress - The trader's wallet address
 * @returns {Promise<Object>} - { swapType: 'entry'|'exit', relatedEntrySwapId?: ObjectId, exitRatio?: number }
 */
const detectSwapType = async (swap, walletAddress) => {
  try {
    // For Solana, we need to check if this is selling a token we previously bought
    const tokenBeingSold = swap.tokenIn;
    
    // Check if we have any previous entry swaps for this token from the same wallet
    const previousEntries = await Swap.find({
      sourceWallet: walletAddress,
      sourceChain: "solana",
      swapType: "entry",
      "tokenOut.address": tokenBeingSold.address,
      processed: true,
      "status.code": { $in: ["completed", "submitted"] }
    }).sort({ sourceTimestamp: -1 });

    if (previousEntries.length === 0) {
      // No previous entries found, this is a new entry
      return {
        swapType: "entry",
        relatedEntrySwapId: null,
        exitRatio: null
      };
    }

    // This is an exit - find the most recent related entry
    const relatedEntry = previousEntries[0];
    
    // Calculate exit ratio based on USD values
    const entryUsdValue = relatedEntry.usdValue || 0;
    const exitUsdValue = swap.usdValue || 0;
    
    let exitRatio = 1;
    if (entryUsdValue > 0) {
      exitRatio = exitUsdValue / entryUsdValue;
    }

    return {
      swapType: "exit",
      relatedEntrySwapId: relatedEntry._id,
      exitRatio: exitRatio
    };

  } catch (error) {
    console.error("Error detecting swap type:", error);
    // Default to entry if we can't determine
    return {
      swapType: "entry",
      relatedEntrySwapId: null,
      exitRatio: null
    };
  }
};

/**
 * Calculate the amount we should trade based on swap type and ratios
 * @param {Object} swap - The original swap data
 * @param {Object} positionInfo - Result from detectSwapType
 * @returns {Promise<Object>} - { amount: string, tokenAddress: string }
 */
const calculateTradeAmount = async (swap, positionInfo) => {
  const fixedSolAmount = process.env.SOLANA_FIXED_ENTRY_AMOUNT || "0.07";
  
  if (positionInfo.swapType === "entry") {
    // For entries, always use fixed SOL amount
    // If buying token with SOL, use fixed SOL amount
    // If buying SOL with token, calculate equivalent token amount
    
    if (swap.tokenIn.symbol === "SOL" || swap.tokenIn.address === "So11111111111111111111111111111111111111112") {
      // Buying token with SOL - use fixed SOL amount
      return {
        amount: fixedSolAmount,
        tokenAddress: swap.tokenIn.address
      };
    } else {
      // Buying SOL with token - calculate equivalent token amount based on original ratio
      const originalSolAmount = parseFloat(swap.tokenOut.amount);
      const originalTokenAmount = parseFloat(swap.tokenIn.amount);
      
      if (originalSolAmount > 0) {
        const tokenPerSol = originalTokenAmount / originalSolAmount;
        const calculatedTokenAmount = parseFloat(fixedSolAmount) * tokenPerSol;
        
        return {
          amount: calculatedTokenAmount.toString(),
          tokenAddress: swap.tokenIn.address
        };
      }
      
      // Fallback to original amount if calculation fails
      return {
        amount: swap.tokenIn.amount,
        tokenAddress: swap.tokenIn.address
      };
    }
  } else {
    // For exits, calculate based on our position and the exit ratio
    try {
      const relatedEntry = await Swap.findById(positionInfo.relatedEntrySwapId);
      if (!relatedEntry) {
        console.warn("Could not find related entry swap, using original amount");
        return {
          amount: swap.tokenIn.amount,
          tokenAddress: swap.tokenIn.address
        };
      }

      // Get our position value and apply the exit ratio
      const myPositionValue = parseFloat(relatedEntry.myPositionValue || fixedSolAmount);
      const exitAmount = myPositionValue * (positionInfo.exitRatio || 1);
      
      return {
        amount: exitAmount.toString(),
        tokenAddress: swap.tokenIn.address
      };

    } catch (error) {
      console.error("Error calculating exit amount:", error);
      // Fallback to proportional amount based on original
      return {
        amount: swap.tokenIn.amount,
        tokenAddress: swap.tokenIn.address
      };
    }
  }
};

/**
 * Get current token balance for a wallet to help detect position changes
 * @param {string} walletAddress - Trader's wallet address  
 * @param {string} tokenAddress - Token contract address
 * @returns {Promise<string>} - Token balance as string
 */
const getTokenBalance = async (walletAddress, tokenAddress) => {
  // This would require additional API calls to get real-time balances
  // For now, we'll estimate based on swap history
  try {
    const swaps = await Swap.find({
      sourceWallet: walletAddress,
      sourceChain: "solana",
      $or: [
        { "tokenIn.address": tokenAddress },
        { "tokenOut.address": tokenAddress }
      ]
    }).sort({ sourceTimestamp: 1 });

    let balance = 0;
    
    for (const swap of swaps) {
      if (swap.tokenOut.address === tokenAddress) {
        // Bought this token
        balance += parseFloat(swap.tokenOut.amount);
      } else if (swap.tokenIn.address === tokenAddress) {
        // Sold this token
        balance -= parseFloat(swap.tokenIn.amount);
      }
    }

    return Math.max(0, balance).toString();
  } catch (error) {
    console.error("Error calculating token balance:", error);
    return "0";
  }
};

module.exports = {
  detectSwapType,
  calculateTradeAmount,
  getTokenBalance
};