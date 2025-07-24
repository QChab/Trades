# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Electron application for DeFi trading that performs ERC20 token trades across multiple decentralized exchanges (Uniswap and Balancer). The application is optimized for macOS and includes advanced features like MEV protection, automated trading strategies, and limit orders.

## Key Commands

### Development
```bash
npm start                    # Start Electron app in development mode
npm run vite:dev            # Build Vue app with watch mode 
npm run vite:build          # Build Vue app once
npm run build               # Full production build (Vue + Electron)
npm run buildSign           # Build and sign for macOS distribution
```

### Testing & Quality
```bash
npm test                    # Run Jest unit tests
npm run lint                # ESLint for .js and .vue files
```

### Distribution (macOS)
```bash
npm run build
xcrun notarytool submit "./dist/trades-1.1.2-arm64.dmg" --apple-id "thibault@techinblocks.com" --password "txuv-flqw-bboi-yhqj" --team-id "BAXBQTTS3U" --wait --progress
xcrun stapler staple "dist/trades-1.1.2-arm64.dmg"
```

## Architecture

### Core Structure
- **Electron Main Process** (`main.mjs`): Handles system integration, database operations, file encryption, and secure key storage
- **Vue Renderer** (`src/renderer/`): Frontend interface built with Vue 3 and Vite
- **Smart Contracts** (`contracts/`): WalletBundler system for MEV-protected trading

### Trading System Architecture

#### Multi-DEX Integration
The application integrates with multiple DEXs through a unified interface:
- **Uniswap V4**: Via Universal Router (0x66a9893cc07d91d95644aedd05d03f95e1dba8af)
- **Balancer**: Via Vault contract (0xBA12222222228d8Ba445958a75a0704d566BF2C8)
- **Permit2**: For secure token approvals (0x000000000022D473030F116dDEE9F6B43aC78BA3)

#### Order Management System
- **Manual Trading**: Market and limit orders with price inversion support
- **Automatic Trading**: Grid trading with buy/sell levels based on token price matrices
- **Limit Orders**: Complex trigger logic supporting take-profit and stop-loss scenarios

#### MEV Protection
- **WalletBundler Contracts**: Individual per-wallet contracts for atomic multi-DEX execution
- **Transaction Bundling**: Multiple trades executed atomically to prevent sandwich attacks
- **Factory Pattern**: Efficient deployment using CREATE2 for deterministic addresses

### Key Components

#### ManualTrading.vue
Central trading interface containing:
- Order type determination logic (take profit vs stop loss)
- Price inversion handling for different token pair displays
- Gas cost calculation with negative value protection
- Mixed trade optimization (combining Uniswap + Balancer)
- Trigger condition evaluation with exact execution price calculations

#### Trade Execution Logic
Complex price comparison system handles:
- `shouldSwitchTokensForLimit`: Controls price display inversion
- Normalized price calculations for consistent order type determination  
- Gas cost deduction with underflow protection (BigNumber limitations)
- Mixed trade sorting by profitability including negative scenarios

#### Data Persistence
- **SQLite Database**: Trade history and transaction records
- **Encrypted Storage**: Private keys using AES-256 encryption
- **JSON Configuration**: Settings, token lists, and trading parameters

### Critical Implementation Details

#### Price Calculations
- Exact execution prices account for gas costs and slippage
- Negative trade scenarios handled with separate tracking variables
- Price inversion logic ensures consistent user experience across different token pairs

#### Gas Cost Handling
The system implements sophisticated gas cost calculations:
- Prevents BigNumber underflow when gas exceeds trade output
- Tracks negative outputs separately for comparison
- Mixed trades calculate combined gas costs correctly

#### Security Model
- Each wallet deploys its own bundler contract (complete isolation)
- Only contract owner can execute trades
- Emergency withdrawal functionality for stuck funds
- Automatic fund transfers back to owner after execution

## Development Notes

### Vue 3 + Vite Setup
- Root directory: `src/renderer/`
- Build output: `vue-dist/`
- ES2022 target with ESM modules
- JSBI pre-bundling for SDK compatibility

### Testing Configuration
- Jest with Vue 3 support
- Test files: `**/tests/unit/**/*.spec.(js|jsx|ts|tsx)`
- jsdom environment for DOM testing
- Module aliases: `@/` maps to `src/`

### Electron Integration
- Main process handles blockchain interactions
- IPC communication for secure operations
- macOS-specific optimizations and signing
- Developer tools auto-open in development mode

When working with this codebase, pay special attention to the order type determination logic, gas cost calculations, and price inversion handling as these are complex areas with many edge cases that have been specifically addressed.

## Recent Critical Fixes and Implementations

### Token Address Validation System
- **Save/Load Operations**: Both `save-settings` and `load-settings` handlers in `main.mjs` now validate token addresses
- **Validation Logic**: Trims whitespace, validates with `ethers.utils.isAddress()`, converts to lowercase
- **Invalid Address Handling**: Automatically clears invalid addresses, accepts empty strings and zero address for ETH
- **Frontend Validation**: `toggleEditingTokens()` function in ManualTrading.vue validates addresses when exiting edit mode

### Price Display and Order Management
- **Current Market Price Display**: Added `getCurrentMarketPrice()` function and display in pending orders
- **Order Type Logic**: Fixed normalization of inverted prices for correct take-profit vs stop-loss determination
- **Trigger Display**: Shows "If 1 TOKEN ≥/≤ PRICE" format with current market price context

### Gas Cost Handling Critical Updates
- **BigNumber Underflow Prevention**: Added checks to prevent negative BigNumber operations
- **Negative Value Tracking**: Separate tracking variables for unprofitable trades
- **Mixed Trade Comparison**: Enhanced sorting logic to handle negative outputs correctly
- **Trade Selection**: Fixed logic to choose "least bad" option when all trades are unprofitable

### Limit Order Execution Fix
- **approveSpending Function**: Updated to accept `localTradeSummary` parameter instead of always using global `tradeSummary`
- **executeTradeWithAddress**: Now passes `limitOrderTradeSummary` to `approveSpending` for correct protocol detection
- **Critical Issue**: Was using wrong protocol/token address for limit order approvals

### MEV Protection Architecture
- **WalletBundler Contracts**: Individual per-wallet contracts for atomic multi-DEX execution
- **Factory Pattern**: CREATE2 deployment for efficient contract creation
- **Partial Execution**: Allows some trades to fail while others succeed
- **Automatic Fund Transfer**: Built-in logic to return funds to owner after execution

### 1inch Integration Analysis
- **API Limitations**: 1 RPS rate limit on basic tier, registration required since 2023
- **No Platform Fees**: 1inch doesn't charge trading fees, only captures rare positive slippage (~1%)
- **Direct Contract Usage**: Technically possible but impractical due to proprietary routing algorithm
- **Recommendation**: Use direct DEX integration instead of 1inch aggregation

### Development Pain Points to Avoid
- **Price Inversion Logic**: Complex interaction between `shouldSwitchTokensForLimit` and order types
- **Gas Cost Edge Cases**: When gas exceeds trade output, requires special handling
- **BigNumber Limitations**: No native negative number support, requires workarounds
- **Trade Summary Context**: Always verify which trade summary object is being used (global vs local)

### Testing and Validation Notes
- **Address Validation**: Test with malformed addresses, trailing spaces, mixed case
- **Negative Scenarios**: Test high gas costs that exceed trade outputs
- **Order Type Edge Cases**: Test price inversions with different token pairs
- **Limit Order Execution**: Verify correct protocol is used for approvals

### New Limit Order System (Latest Implementation)
- **Removed OrderType Logic**: Eliminated stop_loss/take_profit distinction entirely
- **Price Comparison**: Uses `shouldSwitchTokensForLimit` flag for trigger evaluation
  - Normal: `fromTokenPrice >= limitPrice * toTokenPrice`
  - Inverted: `toTokenPrice <= priceLimit * fromTokenPrice`
- **Dichotomy Algorithm**: Binary search for optimal executable amounts with 2.5% precision
- **Partial Execution**: Allows orders to execute at 97.5% of remaining amount
- **Order Locking**: `orderExecutionLocks` Map prevents parallel execution of same order
- **Test Mode**: Complete simulation without blockchain interaction or balance modifications
- **20% Loss Protection**: USD value comparison before execution to prevent excessive losses
- **Automatic Order Logic**: Buy levels use `shouldSwitchTokensForLimit: false`, sell levels use `true`
- **Execution Function**: `tryExecutePendingOrder()` handles all execution logic with proper error handling