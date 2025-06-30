# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Telegram Copy Trading Bot that tracks wallets across multiple blockchains (Ethereum, Base, Polygon, Solana) and automatically copies their swap transactions. The bot uses Moralis for blockchain data, 1inch for EVM swaps, and Jupiter for Solana swaps.

## Development Commands

### Essential Commands
- `node src/index.js` - Start the bot in production mode
- `nodemon src/index.js` - Start the bot with nodemon for development
- `node scripts/initDb.js` - Initialize the MongoDB database with default chains and configuration

### Database Setup
Before first run, you must:
1. Set up MongoDB (local or remote)
2. Create a `.env` file with all required environment variables (see README.md)
3. Run `npm run init-db` to initialize chains and bot configuration

## Architecture Overview

### Core Services Architecture
The application follows a service-oriented architecture with three main background services:

1. **Swap Fetcher Service** (`src/services/polling/swapFetcher.js`)
   - Polls Moralis API for new swaps from tracked wallets
   - Runs every 60 seconds (configurable via `NEW_SWAP_POLLING_FREQ`)
   - Filters swaps to only include those after wallet tracking started
   - Uses a 5-minute window to avoid processing old swaps

2. **Swap Processor Service** (`src/services/polling/swapProcessor.js`)
   - Processes pending swaps from the database
   - Executes actual trades using 1inch (EVM) or Jupiter (Solana)
   - Runs every 30 seconds (configurable via `SWAP_PROCESSING_FREQ`)
   - Sends Telegram notifications for completed/failed swaps

3. **Cleanup Service** (`src/services/cleanup.js`)
   - Removes old processed swaps from database
   - Runs every hour (configurable via `CLEANUP_FREQ`)
   - Prevents database bloat

### Multi-Chain Support
- **EVM Chains**: Ethereum, Base, Polygon (via 1inch API)
- **Solana**: Native Solana swaps (via Jupiter API)
- Chain configurations are stored in MongoDB and initialized via `scripts/initDb.js`

### Database Models
- **TrackedWallet**: Wallets being monitored for swaps
- **Swap**: Individual swap transactions and their processing status
- **Chain**: Blockchain configuration (RPC URLs, native tokens, etc.)
- **BotConfig**: Bot settings and runtime configuration

### Telegram Integration
- Command handlers in `src/telegram/commands.js`
- Messages and formatting in `src/telegram/messages.js`
- Chat ID management for notifications

## Key Implementation Details

### Swap Execution Flow
1. Moralis API detects new swap from tracked wallet
2. Swap data is stored in database with `pending` status
3. Swap processor picks up pending swaps
4. For EVM: Uses 1inch API with token approval handling
5. For Solana: Uses Jupiter API for direct execution
6. Transaction is submitted (not waited for confirmation)
7. User receives Telegram notification

### Token Handling
- Native tokens use special addresses (0x0000...0000 for ETH, chain-specific for others)
- ERC20 tokens require approval before swapping
- Uses infinite approval for gas optimization
- Balance checks before execution to prevent failed transactions

### Configuration Management
- All sensitive data in `.env` file
- Chain configurations in MongoDB
- Bot status controlled via database settings
- Polling frequencies configurable via environment variables

## Development Notes

### When Working with Swaps
- Swap amounts are stored as strings to preserve precision
- Always use the token's actual decimals from contract calls
- Handle native token special cases (different address formats)
- Transaction confirmation is not awaited to improve performance

### Database Considerations
- Unique indexes on (sourceWallet, sourceChain, sourceTxHash) prevent duplicate swaps
- Soft delete pattern used for tracked wallets (isActive flag)
- Cleanup service prevents database bloat from processed swaps

### Error Handling
- All services have comprehensive error handling with Telegram notifications
- API rate limiting and retry logic built into Moralis and 1inch integrations
- Balance validation before swap execution to prevent failed transactions

### Security
- Private keys stored in environment variables only
- No private keys in code or database
- API keys managed via environment variables
- Input validation on all Telegram commands