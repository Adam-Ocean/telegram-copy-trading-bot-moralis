// src/db/models/swaps.js
const mongoose = require("mongoose");

const swapSchema = new mongoose.Schema(
  {
    // Source information
    sourceWallet: {
      type: String,
      required: true,
      trim: true,
    },
    sourceChain: {
      type: String,
      required: true,
      trim: true,
    },
    sourceTxHash: {
      type: String,
      required: true,
      trim: true,
    },
    sourceTimestamp: {
      type: Date,
      required: true,
    },

    // Token information
    tokenIn: {
      address: {
        type: String,
        required: true,
        trim: true,
      },
      symbol: {
        type: String,
        required: true,
        trim: true,
      },
      name: {
        type: String,
        required: true,
        trim: true,
      },
      amount: {
        type: String,
        required: true,
      },
      decimals: {
        type: Number,
        required: true,
      },
    },
    tokenOut: {
      address: {
        type: String,
        required: true,
        trim: true,
      },
      symbol: {
        type: String,
        required: true,
        trim: true,
      },
      name: {
        type: String,
        required: true,
        trim: true,
      },
      amount: {
        type: String,
        required: true,
      },
      decimals: {
        type: Number,
        required: true,
      },
    },

    // USD value of the swap (for reporting)
    usdValue: {
      type: Number,
      required: true,
      default: 0,
    },

    // Exchange information
    exchangeInfo: {
      name: {
        type: String,
        trim: true,
        default: "",
      },
      address: {
        type: String,
        trim: true,
        default: "",
      },
      pairAddress: {
        type: String,
        trim: true,
        default: "",
      },
    },

    // Processing information
    processed: {
      type: Boolean,
      default: false,
    },
    processingTimestamp: {
      type: Date,
      default: null,
    },
    ourTxHash: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      code: {
        type: String,
        enum: ["pending", "completed", "failed", "skipped", "submitted"], // Added 'submitted' status
        default: "pending",
      },
      message: {
        type: String,
        default: "",
      },
    },

    // Position tracking fields for ratio-based copy trading
    swapType: {
      type: String,
      enum: ["entry", "exit"],
      default: "entry",
    },
    relatedEntrySwapId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Swap",
      default: null,
    },
    traderTokenBalance: {
      type: String,
      default: "0",
    },
    myPositionValue: {
      type: String,
      default: "0",
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
  }
);

// Add indexes for better query performance
swapSchema.index(
  { sourceWallet: 1, sourceChain: 1, sourceTxHash: 1 },
  { unique: true }
);
swapSchema.index({ processed: 1, "status.code": 1 });
swapSchema.index({ sourceTimestamp: 1 });

const Swap = mongoose.model("Swap", swapSchema);

module.exports = Swap;
