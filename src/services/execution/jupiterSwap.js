// src/services/execution/jupiterSwap.js
const axios = require("axios");
const {
  Connection,
  PublicKey,
  VersionedTransaction,
} = require("@solana/web3.js");
const { getSolanaConnection, getSolanaWallet } = require("../wallets/solana");
const base58 = require("base-58");
require("dotenv").config();

// Execute a swap using Jupiter Ultra API for Solana
const executeJupiterSwap = async (swap) => {
  try {
    console.log(
      `Executing Jupiter Ultra swap on Solana for tx: ${swap.sourceTxHash}`
    );

    const connection = getSolanaConnection();
    const wallet = getSolanaWallet();
    const userPublicKey = wallet.publicKey.toString();

    // Get input and output tokens
    const fromToken = swap.tokenIn;
    const toToken = swap.tokenOut;

    // Use calculated amount from position tracker if available, otherwise use original amount
    const tradeAmount = swap.myPositionValue && swap.myPositionValue !== "0" 
      ? swap.myPositionValue 
      : fromToken.amount;

    console.log(
      `Swapping ${tradeAmount} ${fromToken.symbol} to ${toToken.symbol} (ratio-based amount)`
    );

    // Check if the token addresses are valid
    if (!fromToken.address || !toToken.address) {
      throw new Error(
        `Invalid token addresses: ${fromToken.address} -> ${toToken.address}`
      );
    }

    // Convert amount to the correct format (with decimals)
      
    const inputAmount = Math.floor(
      parseFloat(tradeAmount) * Math.pow(10, fromToken.decimals)
    );
    if (isNaN(inputAmount) || inputAmount <= 0) {
      throw new Error(`Invalid amount: ${tradeAmount}`);
    }
    
    console.log(`Using calculated trade amount: ${tradeAmount} ${fromToken.symbol} (original: ${fromToken.amount})`);
    console.log(`Swap type: ${swap.swapType || 'entry'}`);
    if (swap.relatedEntrySwapId) {
      console.log(`Related entry swap: ${swap.relatedEntrySwapId}`);
    }

    // Check wallet balance
    try {
      let balance;
      if (fromToken.address === "So11111111111111111111111111111111111111112") {
        // Native SOL
        balance = await connection.getBalance(wallet.publicKey);
        console.log(`SOL balance: ${balance / 1000000000} SOL`);
      } else {
        // For SPL tokens, you'd need to implement token balance checking
        // This is a placeholder - in production, implement proper SPL balance checking
        console.log(`Warning: SPL token balance check not implemented`);
        balance = inputAmount * 2; // Assuming we have enough for now
      }

      // Add buffer for transaction fees (0.01 SOL)
      const neededAmount =
        fromToken.address === "So11111111111111111111111111111111111111112"
          ? inputAmount + 10000000 // Add 0.01 SOL for fees if swapping SOL
          : inputAmount;

      if (balance < neededAmount) {
        throw new Error(
          `Insufficient balance. Have ${
            balance / Math.pow(10, fromToken.decimals)
          } ${fromToken.symbol}, need at least ${
            neededAmount / Math.pow(10, fromToken.decimals)
          } ${fromToken.symbol}`
        );
      }
    } catch (balanceError) {
      console.error("Error checking balance:", balanceError);
      throw new Error(`Failed to verify balance: ${balanceError.message}`);
    }

    // Step 1: Get Order from Jupiter Ultra API
    console.log("Fetching order from Jupiter Ultra API...");

    const orderUrl = new URL("https://lite-api.jup.ag/ultra/v1/order");
    orderUrl.searchParams.append("inputMint", fromToken.address);
    orderUrl.searchParams.append("outputMint", toToken.address);
    orderUrl.searchParams.append("amount", inputAmount.toString());
    orderUrl.searchParams.append("taker", userPublicKey);

    const { data: orderResponse } = await axios.get(orderUrl.toString());

    if (!orderResponse || !orderResponse.transaction) {
      throw new Error(
        `Failed to get order from Jupiter Ultra: ${JSON.stringify(
          orderResponse
        )}`
      );
    }

    const expectedOutputAmount =
      orderResponse.outAmount / Math.pow(10, toToken.decimals);
    console.log(
      `Order received. Expected output: ${expectedOutputAmount} ${toToken.symbol}`
    );

    if (orderResponse.routePlan && orderResponse.routePlan.length > 0) {
      const route = orderResponse.routePlan
        .map((r) => r.swapInfo.label)
        .join(" -> ");
      console.log(`Route: ${route}`);
    }

    // Step 2: Sign Transaction
    const transactionBase64 = orderResponse.transaction;
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(transactionBase64, "base64")
    );

    // Sign the transaction
    transaction.sign([wallet]);

    // Serialize the transaction to base64 format
    const signedTransaction = Buffer.from(transaction.serialize()).toString(
      "base64"
    );

    // Step 3: Execute Order
    console.log("Submitting transaction to Jupiter Ultra API...");
    const { data: executeResponse } = await axios.post(
      "https://lite-api.jup.ag/ultra/v1/execute",
      {
        signedTransaction: signedTransaction,
        requestId: orderResponse.requestId,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    // Handle response
    if (executeResponse.status === "Success") {
      console.log("Swap successful!");
      const inputAmount =
        executeResponse.inputAmountResult / Math.pow(10, fromToken.decimals);
      const outputAmount =
        executeResponse.outputAmountResult / Math.pow(10, toToken.decimals);

      console.log(`Input: ${inputAmount} ${fromToken.symbol}`);
      console.log(`Output: ${outputAmount} ${toToken.symbol}`);
      console.log(
        `Transaction: https://solscan.io/tx/${executeResponse.signature}`
      );

      return {
        success: true,
        txHash: executeResponse.signature,
        message: `Transaction executed successfully: ${inputAmount} ${fromToken.symbol} → ${outputAmount} ${toToken.symbol}`,
      };
    } else {
      throw new Error(
        `Swap execution failed: ${JSON.stringify(executeResponse)}`
      );
    }
  } catch (error) {
    console.error("Error executing Jupiter Ultra swap:", error);
    return {
      success: false,
      error: error.message || "Jupiter swap failed without specific error",
    };
  }
};

module.exports = {
  executeJupiterSwap,
};
