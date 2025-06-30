// src/services/polling/swapProcessor.js
const Swap = require("../../db/models/swaps");
const Chain = require("../../db/models/chains");
const BotConfig = require("../../db/models/botConfig");
const TrackedWallet = require("../../db/models/trackedWallets");
const { executeInchSwap } = require("../execution/inchSwap");
const { executeJupiterSwap } = require("../execution/jupiterSwap");
const { getBot } = require("../../telegram");
const {
  formatSwapNotification,
  formatErrorNotification,
} = require("../../telegram/messages");
const { detectSwapType, calculateTradeAmount, getTokenBalance } = require("../positionTracker");
require("dotenv").config();

let isRunning = false;
let pollingInterval;

/**
 * Sends a notification to the stored chat ID
 * @param {string} message - The message to send
 * @param {object} options - Options for the message (like parse_mode)
 */
const sendNotification = async (
  message,
  options = { parse_mode: "Markdown" }
) => {
  const bot = getBot();
  let messageSent = false;

  try {
    // First, try to get chat ID from database
    const chatIdConfig = await BotConfig.findOne({ setting: "chatId" });

    if (chatIdConfig && chatIdConfig.value) {
      try {
        await bot.sendMessage(chatIdConfig.value, message, options);
        messageSent = true;
        return true;
      } catch (err) {
        console.error(
          `Failed to send message to stored chat ID ${chatIdConfig.value}:`,
          err.message
        );

        // Try again with plain text if markdown fails
        if (options.parse_mode === "Markdown") {
          try {
            await bot.sendMessage(
              chatIdConfig.value,
              "⚠️ Failed to send formatted message. Here's the plain text version:\n\n" +
                message
                  .replace(/\*/g, "")
                  .replace(/\`/g, "")
                  .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1"),
              { parse_mode: undefined }
            );
            messageSent = true;
            return true;
          } catch (plainTextErr) {
            console.error(
              `Failed to send plain text message: ${plainTextErr.message}`
            );
          }
        }
      }
    }

    // If no message was sent and we have an admin chat ID in env, try that as fallback
    if (!messageSent && process.env.ADMIN_CHAT_ID) {
      try {
        await bot.sendMessage(process.env.ADMIN_CHAT_ID, message, options);
        messageSent = true;
        return true;
      } catch (err) {
        console.error(`Failed to send message to admin chat:`, err.message);
      }
    }

    // If still no success, log it clearly
    if (!messageSent) {
      console.error(
        "❌ NOTIFICATION DELIVERY FAILED: Could not send Telegram message to any chat"
      );
      console.error("Message content was:", message);
      return false;
    }
  } catch (dbError) {
    console.error("Error fetching chat ID from database:", dbError);

    // Try fallback to environment variable
    if (process.env.ADMIN_CHAT_ID) {
      try {
        await bot.sendMessage(process.env.ADMIN_CHAT_ID, message, options);
        return true;
      } catch (err) {
        console.error(`Failed to send message to admin chat:`, err.message);
      }
    }

    console.error(
      "❌ NOTIFICATION DELIVERY FAILED: Could not send Telegram message to any chat"
    );
    console.error("Message content was:", message);
    return false;
  }

  return messageSent;
};

/**
 * Process pending swaps in the queue
 */
const processSwaps = async () => {
  // Skip if already running to prevent overlap
  if (isRunning) return;
  isRunning = true;

  try {
    // Check if bot is running
    const botConfig = await BotConfig.findOne({ setting: "botStatus" });
    if (botConfig && botConfig.value !== "running") {
      console.log("Bot is not running. Skipping swap processing.");
      isRunning = false;
      return;
    }

    console.log("Processing pending swaps...");

    // Get pending swaps ordered by timestamp (oldest first)
    const pendingSwaps = await Swap.find({
      processed: false,
      "status.code": "pending",
    })
      .sort({ sourceTimestamp: 1 })
      .limit(10); // Process in batches of 10

    if (pendingSwaps.length === 0) {
      console.log("No pending swaps to process.");
      isRunning = false;
      return;
    }

    console.log(`Found ${pendingSwaps.length} unprocessed swaps to process.`);

    // Track results for summary
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Process each swap in sequence to maintain order
    for (const swap of pendingSwaps) {
      try {
        // Skip swaps that occurred before the wallet was tracked
        const wallet = await TrackedWallet.findOne({
          address: swap.sourceWallet,
          chain: swap.sourceChain,
        });

        if (wallet && new Date(swap.sourceTimestamp) < wallet.createdAt) {
          console.log(
            `Skipping swap ${swap.sourceTxHash} - occurred before tracking started`
          );

          // Mark as processed but skipped
          swap.processed = true;
          swap.processingTimestamp = new Date();
          swap.status = {
            code: "skipped",
            message: "Swap occurred before wallet tracking was started",
          };
          await swap.save();

          skippedCount++;
          continue;
        }

        console.log(`Processing swap: ${swap.sourceTxHash}`);

        // Get chain information
        const chain = await Chain.findOne({ chainId: swap.sourceChain });

        if (!chain) {
          throw new Error(`Chain ${swap.sourceChain} not found`);
        }

        // For Solana swaps, add position tracking logic
        if (chain.type === "solana") {
          try {
            // Detect swap type and calculate appropriate amounts
            const positionInfo = await detectSwapType(swap, swap.sourceWallet);
            const tradeAmount = await calculateTradeAmount(swap, positionInfo);
            
            // Update swap with position tracking info
            swap.swapType = positionInfo.swapType;
            swap.relatedEntrySwapId = positionInfo.relatedEntrySwapId;
            swap.traderTokenBalance = await getTokenBalance(swap.sourceWallet, swap.tokenIn.address);
            swap.myPositionValue = tradeAmount.amount;
            
            // Save the updated swap info
            await swap.save();
            
            console.log(`Swap type: ${positionInfo.swapType}, Trade amount: ${tradeAmount.amount}`);
            if (positionInfo.exitRatio) {
              console.log(`Exit ratio: ${positionInfo.exitRatio}x`);
            }
          } catch (positionError) {
            console.error("Error in position tracking:", positionError);
            // Continue with original swap if position tracking fails
          }
        }

        // Execute the swap based on chain type
        let result;
        if (chain.type === "evm") {
          result = await executeInchSwap(swap, chain);
        } else if (chain.type === "solana") {
          result = await executeJupiterSwap(swap);
        } else {
          throw new Error(`Unsupported chain type: ${chain.type}`);
        }

        // Update swap record
        if (result.success) {
          swap.processed = true;
          swap.processingTimestamp = new Date();
          swap.ourTxHash = result.txHash;
          swap.status = {
            code: "completed", // Using "completed" instead of "submitted" to match existing schema
            message: "Swap transaction submitted to the network",
          };
          await swap.save();

          successCount++;
          console.log(`Swap submitted successfully: ${result.txHash}`);

          // Send success notification
          const notificationMessage = formatSwapNotification(
            swap,
            result.txHash,
            chain
          );
          await sendNotification(notificationMessage);
        } else {
          swap.status = {
            code: "failed",
            message: result.error,
          };
          await swap.save();

          failedCount++;
          console.log(`Swap execution failed: ${result.error}`);

          // Send failure notification if configured
          const notifyOnFailed = await BotConfig.findOne({
            setting: "notifyOnFailed",
          });
          if (notifyOnFailed && notifyOnFailed.value) {
            const errorMessage = formatErrorNotification(
              swap,
              result.error,
              chain
            );
            await sendNotification(errorMessage);
          }
        }
      } catch (error) {
        console.error(`Error processing swap ${swap.sourceTxHash}:`, error);
        failedCount++;

        // Update swap record with error
        swap.status = {
          code: "failed",
          message: error.message,
        };
        await swap.save();

        // Send failure notification if configured
        const notifyOnFailed = await BotConfig.findOne({
          setting: "notifyOnFailed",
        });
        if (notifyOnFailed && notifyOnFailed.value) {
          try {
            const chain = await Chain.findOne({ chainId: swap.sourceChain });
            const errorMessage = formatErrorNotification(
              swap,
              error.message,
              chain
            );
            await sendNotification(errorMessage);
          } catch (notifyError) {
            console.error("Error sending notification:", notifyError.message);
          }
        }
      }
    }

    // Print summary
    console.log(
      `Swap processing completed: ${successCount} submitted, ${failedCount} failed, ${skippedCount} skipped`
    );
  } catch (error) {
    console.error("Error processing swaps:", error);
    // Send error notification to the bot owner
    try {
      await sendNotification(`❌ Error processing swaps: ${error.message}`);
    } catch (e) {
      console.error("Error sending notification:", e.message);
    }
  } finally {
    isRunning = false;
  }
};

/**
 * Start the swap processor service
 */
const startSwapProcessor = async () => {
  try {
    // Initial processing
    await processSwaps();

    // Set up polling interval
    const pollFreq = parseInt(process.env.SWAP_PROCESSING_FREQ) || 30000; // Default: 30 seconds
    pollingInterval = setInterval(processSwaps, pollFreq);

    console.log(`Swap processor started with polling frequency: ${pollFreq}ms`);
    return true;
  } catch (error) {
    console.error("Error starting swap processor:", error);
    return false;
  }
};

/**
 * Stop the swap processor service
 */
const stopSwapProcessor = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    console.log("Swap processor stopped");
    return true;
  }
  return false;
};

module.exports = {
  startSwapProcessor,
  stopSwapProcessor,
  processSwaps,
  sendNotification,
};
