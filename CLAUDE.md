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

#### Quote Aggregator System (Latest Architecture)
The trading system uses a unified quote aggregator (`quoteAggregator.js`) that queries all available protocols in parallel and selects the best quote after accounting for gas costs.

**Protocol Identifiers**:
- **"Uniswap"**: Direct Uniswap V4 execution via Universal Router
- **"Balancer"**: Direct Balancer V3 execution via Vault contract
- **"Contract"** (WalletBundler): MEV-protected multi-DEX atomic trades via personal bundler contract
- **"Odos"**: Odos aggregator API for cross-DEX routing

**Wallet Mode Filtering**:
- **"contract"**: Only WalletBundler
- **"odos"**: Only Odos aggregator
- **"odos & contract"**: Both WalletBundler and Odos
- **undefined/none**: All 4 protocols (Uniswap, Balancer, WalletBundler, Odos)

**Key Features**:
- Queries protocols with 100% of input amount (no percentage-based splits)
- Parallel quote fetching using Promise.allSettled for redundancy
- Gas-cost-aware best quote selection
- Standardized response format: `{protocol, outputAmount, gasEstimate, trades, rawData}`
- WalletBundler internally uses sophisticated cross-DEX optimizer (useMixedUniswapBalancer)

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
- **getBestTrades()**: Simplified quote aggregation using quoteAggregator.js (~80 lines vs. previous ~300 lines)
- Order type determination logic (take profit vs stop loss)
- Price inversion handling for different token pair displays
- Gas cost calculation with negative value protection
- Trigger condition evaluation with exact execution price calculations
- **NO checkboxes**: Removed Uniswap/Balancer/Mixed UI checkboxes - best quote auto-selected
- **Wallet mode dropdown**: User selects protocol filtering (Odos, Contract, Odos & Contract, or None)

#### Quote Aggregator Module (quoteAggregator.js)
Unified interface for all protocol quote requests:
- **getQuoteUniswap()**: Queries Uniswap V4 with 100% input amount
- **getQuoteBalancer()**: Queries Balancer V3 with 100% input amount
- **getQuoteWalletBundler()**: Uses useMixedUniswapBalancer for cross-DEX optimization
- **getQuoteOdos()**: Queries Odos aggregator API
- **getAllQuotes()**: Fetches all allowed protocols in parallel
- **selectBestQuote()**: Accounts for gas costs to determine true net output
- **getAllowedProtocols()**: Filters protocols based on wallet mode

#### Trade Execution Logic
Complex price comparison system handles:
- `shouldSwitchTokensForLimit`: Controls price display inversion
- Normalized price calculations for consistent order type determination
- Gas cost deduction with underflow protection (BigNumber limitations)
- Protocol-specific execution paths (Uniswap, Balancer, Contract, Odos)

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

### Electron Integration
- Main process handles blockchain interactions
- IPC communication for secure operations
- macOS-specific optimizations and signing
- Developer tools auto-open in development mode

When working with this codebase, pay special attention to the order type determination logic, gas cost calculations, and price inversion handling as these are complex areas with many edge cases that have been specifically addressed.

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

### WalletBundler Contract Deployment and Address Management

#### Architecture Overview
The application follows a secure Electron architecture where all private key operations occur in the main process:
- **Main Process** (`main.mjs`): Handles wallet access via `getWallet()`, signs transactions, deploys contracts
- **Renderer Process** (Vue components): UI only, communicates via IPC, never has direct access to private keys
- **IPC Bridge** (`preload.js`): Exposes safe APIs to renderer using `contextBridge`

#### Deployment Flow

**1. Main Process - IPC Handlers** (`main.mjs:1097-1119`):
```javascript
ipcMain.handle('deploy-bundler', async (event, walletAddress, salt = 0) => {

ipcMain.handle('get-bundler', async (event, walletAddress) => {
```

**Key Implementation Details**:
- Uses `getWallet(address, isPrivate)` to retrieve wallet from encrypted storage
- Creates `BundlerManager` instance with provider and wallet signer
- Deployment via `BundlerFactory.deployBundler(salt)` using CREATE2
- Returns contract address or null if no bundler exists for wallet
- All blockchain operations stay in main process for security

**2. Preload Script - API Exposure** (`preload.js:41-42`):
```javascript
deployBundler: (walletAddress, salt) => ipcRenderer.invoke('deploy-bundler', walletAddress, salt),
getBundler: (walletAddress) => ipcRenderer.invoke('get-bundler', walletAddress),
```

**3. Renderer Process - UI Integration** (`ManualTrading.vue:261-273, 5070-5089`):
```javascript
  @click="deployBundler"
  {{ isDeploying ? 'Deploying...' : 'Deploy' }}
</button>

  const result = await window.electronAPI.deployBundler(senderDetails.value.address);

  if (result.success && result.address) {
    contractAddress[senderDetails.value.address] = result.address;
    swapMessage.value = 'Bundler deployed successfully!';
  }
};
```

#### BundlerManager Integration (`src/bundler/BundlerManager.js`)

**Factory Contract Interaction**:
- Connects to `WalletBundlerFactory` at deployment address
- Uses wallet signer from main process
- Calls `deployBundler(salt)` for new deployments
- Calls `getBundlersByOwner(address)` to retrieve existing contracts

**Contract Retrieval**:
- Returns first bundler for given owner address
- Factory tracks all bundlers per owner
- Supports multiple bundlers per wallet (via different salt values)

#### Security Considerations

**Private Key Isolation**:
- Private keys never leave main process
- `getWallet()` retrieves from AES-256 encrypted storage
- All signing operations occur in main.mjs
- Renderer only receives transaction results

**Wallet Selection**:
- Deployment tied to `senderDetails.value.address` (current selected wallet)
- Each wallet can have its own bundler contract
- Contract ownership verified on-chain (only owner can execute)

#### Error Handling

**Main Process**:
- Try/catch blocks around all blockchain operations
- Returns `{ success: false, error: message }` on failure
- Logs errors to console for debugging
- Never exposes private key material in errors

**Renderer Process**:
- Displays user-friendly error messages via `swapMessage`
- Disables deploy button during deployment (`isDeploying`)
- Resets state in finally block
- No direct access to underlying error details

#### Future Enhancements
- Persistent storage of contract addresses in database
- Support for multiple bundlers per wallet
- Bundler upgrade mechanism via proxy pattern
- Integration with settings/configuration management

### WalletBundler Execute Method (Latest Implementation)
The `execute` function has been enhanced to support precise wrap/unwrap operations:

#### Function Signature
```solidity
function execute(
    address fromToken,
    uint256 fromAmount,
    address[] calldata targets,
    bytes[] calldata data,
    uint256[] calldata values,
    uint256[] calldata inputAmounts,    // NEW: Amounts for wrap/unwrap operations
    address[] calldata outputTokens,     // NEW: Per-step output tokens
    uint8[] calldata wrapOperations,     // Wrap/unwrap operation codes
    uint256 minOutputAmount
) external payable auth returns (bool[] memory results)
```

#### Wrap/Unwrap Operation Codes
- **0**: No operation (default)
- **1**: Wrap ETH to WETH before call (uses `inputAmounts[i]`)
- **2**: Wrap ETH to WETH after call (calculates output dynamically)
- **3**: Unwrap WETH to ETH before call (uses `inputAmounts[i]`)
- **4**: Unwrap WETH to ETH after call (calculates output dynamically)

#### Key Implementation Details
- **Per-Step Output Tokens**: Each step specifies its output token for precise tracking
- **Dynamic Amount Calculation**: For "after" operations (codes 2 & 4), the contract tracks balances before/after to determine exact amounts
- **Specific Amount Operations**: Only wraps/unwraps the necessary amount, not entire balances
- **ETH Handling**: When `fromToken` is `address(0)`, ETH arrives via `msg.value`
- **Minimum Output Validation**: Ensures final output meets minimum requirement to prevent slippage attacks

### Dynamic Encoding System for Multi-Hop Trades

#### New Method: `encodeAndExecute`
A second execution method that uses encoder contracts to dynamically build calldata based on actual token balances:

```solidity
function encodeAndExecute(
    address[] calldata encoderTargets,
    bytes[] calldata encoderData,
    uint8[] calldata wrapOperations,
    uint256 minOutputAmount
) external payable auth returns (bool[] memory results)
```

#### Encoder Contracts
Two stateless encoder contracts generate calldata dynamically:

**BalancerEncoder.sol**:
- `encodeSingleSwap`: Encodes single Balancer swaps
- `encodeUseAllBalanceSwap`: Special function using `type(uint256).max` marker

**UniswapEncoder.sol**:
- `encodeSingleSwap`: Encodes Uniswap V3/V4 swaps
- `encodeMultiHopSwap`: Encodes multi-hop paths
- `encodeUseAllBalanceSwap`: Uses all available balance

#### Smart Split Detection
The JavaScript function `markSplitLegs` analyzes execution plans to determine when to use exact amounts vs all available balance:

**Token Flow Patterns**:
1. **Parallel Split**: `tokenA` splits to multiple paths
   - First legs: Use exact calculated amounts
   - Last leg: Uses all remaining balance (prevents dust)

2. **Divergent Paths**: Different intermediate tokens
   ```
   Path 1: tokenA → tokenB → tokenC
   Path 2: tokenA → tokenD → tokenC
   ```
   - Hop 1: Split tokenA (exact + remaining)
   - Hop 2: Each path uses ALL of its intermediate token

3. **Sequential Usage**: Same token used in different hops
   - Each hop uses all available balance

#### Slippage Handling Strategy
- **Intermediate Hops**: Use actual output from previous hop (no compound slippage)
- **Final Hop Only**: Enforce minimum output requirement
- **Use All Balance**: Marker `type(uint256).max` tells DEX to use entire balance

#### JavaScript Integration
The `createEncoderExecutionPlan` function in `useMixedUniswapBalancer.js`:
- Analyzes token flow to mark split legs
- Determines which steps should use all balance
- Encodes calldata for encoder contracts
- Handles sender/recipient logic (final hop goes directly to user)

#### Benefits Over Static Execution
1. **No Slippage Accumulation**: Each hop adapts to actual amounts
2. **No Dust or Failures**: Last leg always uses remaining balance
3. **Gas Efficient**: Final output bypasses contract
4. **Flexible Routing**: Handles complex multi-path scenarios

#### Example Execution Flow
```javascript
// 45% Balancer, 55% Uniswap split on first hop
Hop 1, Leg 1: Balancer swaps exact 45% of tokenA
Hop 1, Leg 2: Uniswap swaps ALL REMAINING tokenA
Hop 2: Combined swap uses ALL intermediate tokens to final output
```

This dynamic encoding system ensures robust execution of complex cross-DEX trades while minimizing gas costs and eliminating common failure modes from slippage and rounding errors.

### Odos Aggregator Integration
- **Purpose**: Cross-DEX routing aggregator used as fallback/comparison protocol
- **API Integration**: Uses Odos quote API (useOdos.js) for route discovery
- **Return Format**: Standardized to `{toTokenAmount, estimatedGas, pathId, priceImpact}`
- **Wallet Mode**: Can be enabled via "odos" or "odos & contract" mode
- **Benefits**: Provides independent routing algorithm as backup if WalletBundler fails

### Legacy 1inch Notes
- **Deprecated**: 1inch mode has been replaced with Odos in all UI and logic
- **API Limitations**: 1 RPS rate limit, registration required, not practical for high-frequency use
- **Migration**: All "1inch" references updated to "odos" in wallet modes

### Balancer V3 Integration
- **Pool Discovery**: Queries Balancer V3 subgraph for pool data, handles decimal balance parsing
- **Dynamic Pool Type Detection**: 
  - Queries pool contracts directly to detect WeightedPool vs StablePool
  - Extracts exact weight ratios (80/20, 50/50, 98/2, 95/5, etc.) via `getNormalizedWeights()`
  - Retrieves amplification parameters for stable pools (100000, 500000, 1000000, 4000000)
  - Detects multi-asset weighted pools (30/10/15/10/15/5/15 for 7-token pools)
- **Pool Data Caching System**:
  - Stores pool data in `balancerPoolsCache.json` to avoid repeated blockchain queries
  - Cache includes: pool type, weights, amplification parameters, token balances, addresses, symbols
  - `getPoolData()` checks cache first, only queries blockchain if pool not cached
  - Automatically updates cache when new pools are discovered
  - Cache statistics available via `getCacheStats()` function
  - Dramatically improves performance - cached pools load instantly vs blockchain queries
- **Optimal Pathfinding Algorithm**:
  - Prioritizes common intermediate tokens (WETH, USDC, USDT, DAI) for 2-hop paths
  - Finds direct paths first, then 2-hop through intermediates, then 3-hop via DFS
  - Reduces fees by finding shortest paths (e.g., ONE→WETH→USDC instead of ONE→WETH→WBTC→USDC)
  - Processes WETH-containing pools first for better routing
- **Exact AMM Calculations (NO APPROXIMATIONS)**: 
  - **WeightedPool**: Exact weight-adjusted constant product formula
    - `outputAmount = balanceOut * (1 - (balanceIn / (balanceIn + inputAmount * (1 - fee)))^(weightIn/weightOut))`
  - **StablePool**: Full stable swap invariant with amplification parameter
    - Iterative solver for D invariant (sum + amplification factor)
    - Newton's method for exact output calculations
  - **ConstantProduct**: Standard x*y=k formula with exact fee calculations
  - All calculations use exact BigNumber arithmetic, no floating point approximations
- **Implementation Files**:
  - `useBalancerV3.js`: Main implementation with pool discovery, caching, and exact AMM math
  - `testBalancerV3.js`: Test suite for pool detection and routing verification
  - `balancerPoolsCache.json`: JSON cache file storing pool data to avoid repeated queries

### Testing Configuration Requirements
- **maxHops Parameter**: Never use `maxHops: 1` in tests to simulate production situations
- **Do NOT reduce to 1 hop**: Even for simple tests, maintain realistic multi-hop scenarios
- **Production Parity**: Tests must reflect real-world routing complexity

### Cross-DEX Optimizer (crossDEXOptimizer.js)
- **Purpose**: Provides exact AMM calculations for cross-DEX optimization
- **Core Principle**: ALL calculations must use exact AMM formulas - NO LINEAR APPROXIMATIONS
- **Uniswap Exact Output Calculation**:
  - Handles pool direction correctly (token0/token1 ordering)
  - ETH/WETH equivalence: Automatically maps ETH to WETH for pool lookups
  - Uses Uniswap V3/V4 SDK's `getOutputAmount` for exact constant product calculations
  - Properly determines swap direction based on input token symbol
- **Balancer Exact Output Calculation**:
  - WeightedPool: Exact power law formula with weight ratios
  - StablePool: Full iterative stable swap invariant calculation
  - Applies exact fee calculations (no approximations)
- **Token Direction Handling**:
  - Dynamic token symbol parameters (not hardcoded to specific tokens)
  - Supports both pool directions (ONE→ETH and ETH→ONE pools)
  - Automatic WETH substitution when ETH is used
- **Implementation Philosophy**:
  - Never use linear approximations or simplified formulas
  - All values must be computed using exact AMM mathematics
  - Token parameters must be fully generic (no hardcoded ONE, SEV, ETH)

### Mixed Uniswap-Balancer Router (useMixedUniswapBalancer.js)
- **Purpose**: Optimally routes trades across both Uniswap V4 and Balancer V3 to maximize output
- **Key Innovation**: Handles fragmented liquidity where tokens exist on different DEXs
- **Golden Section Search Optimization**:
  - **Mathematical Foundation**: Uses golden ratio φ = (√5 - 1) / 2 ≈ 0.618
  - **High Precision**: Single-phase with tolerance of 0.00001 (0.001%)
  - **Efficient Convergence**: Typically 24 iterations to find global optimum
  - **Guaranteed Convergence**: O(log(1/ε)) complexity for ε precision
  - **Superior to Alternatives**: 
    - Dichotomy/binary search would need similar iterations but golden ratio minimizes function evaluations
    - Gradient ascent takes 200+ iterations and can oscillate near optimum
  - **Example Performance**: Finds 45.25% Balancer / 54.75% Uniswap split in 24 iterations
- **NO HARDCODED VALUES Policy**:
  - Starting split: Always 50/50 (generic, not token-specific)
  - Intermediate token: Dynamically determined from available pools
  - Token addresses/symbols: Passed as parameters, never hardcoded
  - Target outputs: Only exist in test files for validation
- **Second Hop Calculation**:
  - Uses actual combined output from optimized first hop split
  - Properly handles ETH/WETH fungibility between protocols
  - Exact AMM calculations for all legs (no approximations)
- **Cross-DEX Optimization Flow**:
  1. Find available paths on both Uniswap and Balancer
  2. Initialize golden section search at 50/50 split
  3. Calculate exact outputs for each split percentage
  4. Converge to optimal split using golden ratio
  5. Apply gradient ascent for fine-tuning if needed
  6. Return optimized route with exact split percentages
- **Performance Characteristics**:
  - Golden section: O(log(1/ε)) convergence for ε precision
  - Typically 15-20 iterations for 0.01% precision
  - Example results: 45.25% Balancer / 54.75% Uniswap for ONE→SEV
- **ETH/WETH Handling**:
  - Treats ETH and WETH as equivalent (1:1 conversion)
  - No penalties for wrap/unwrap in optimization
  - Seamless routing between Uniswap ETH pools and Balancer WETH pools
- **Implementation Files**:
  - `useMixedUniswapBalancer.js`: Core router with golden section search
  - `exactAMMOutputs.js`: Exact AMM calculations for both protocols
  - `testCrossDEXRouting.js`: Test file with target values for validation

### Multi-Path Discovery and Optimization System (Latest Implementation)

#### Overview
The routing system now discovers ALL available paths across both DEXs and optimizes splits using exact AMM calculations. This replaces expensive multi-dimensional optimization with a fast, practical approach.

#### Simple Iterative Split Optimization
**Algorithm**: Hill climbing with exact AMM recalculation at each step

**Process**:
1. **Initial Split**: Proportional allocation based on relative outputs
2. **Iterative Improvement**: Try moving 2% between each pair of routes
3. **Exact Recalculation**: For each split configuration, recalculate outputs using exact AMM formulas
4. **Convergence**: Stop when no improvement found
5. **Typical Performance**: Converges in 5-20 iterations, < 2 seconds total

**Code Location**: `optimizeSplitSimple()` at line ~684

#### CRITICAL: Exact AMM Calculations Only

**NO LINEAR APPROXIMATIONS ALLOWED**:
```javascript
// ❌ WRONG - Linear approximation
output = route.totalOutput * (splitAmount / totalAmount)

// ✅ CORRECT - Exact AMM recalculation
output = calculateRouteExactOutput(route, splitAmount)
```

**Implementation Details**:
- `evaluateSplit()`: Evaluates split configuration using exact AMM math (line ~785)
- `calculateRouteExactOutput()`: Routes to exact Balancer or Uniswap calculation (line ~806)
- `calculateBalancerRouteOutput()`: Uses `calculateBalancerExactOutput` from `exactAMMOutputs.js` (line ~852)
- `calculateUniswapRouteOutput()`: Uses Uniswap SDK's `pool.getOutputAmount()` (line ~890)

**Why This Matters**:
- AMM curves are non-linear (weighted pools use power functions, constant product uses hyperbolas)
- Splitting 1000 tokens 50/50 does NOT give 50% of each route's full output
- Must recalculate from scratch for each split amount
- Price impact varies with trade size (larger trades = more slippage)

#### Route Display Format
**Readable Console Output** (via `displayRoutes()` at line ~649):
```
📋 Discovered Routes:
────────────────────────────────────────────────────────────────────────────────
1. [uniswap-path-1]
   Output: 3567.8234 1INCH
   Path: Uniswap path 1
   Protocol: uniswap

2. [balancer-path-1]
   Output: 3456.2100 1INCH
   Path: Balancer path 1 (2 hops)
   Protocol: balancer
   Hops: 2

3. [cross-dex-uniswap-uniswap]
   Output: 3598.1200 1INCH
   Path: AAVE -> USDC -> 1INCH (Uniswap)
   Protocol: uniswap
   Legs: 2
────────────────────────────────────────────────────────────────────────────────
```

#### Best Practices for Route Optimization

**1. Always Use Exact AMM Calculations**:
- Never approximate outputs based on proportional scaling
- Recalculate from scratch for each split configuration
- Use SDK methods (`pool.getOutputAmount`) or exact formulas (`calculateBalancerExactOutput`)

**2. Limit Optimization Iterations**:
- Use simple hill climbing (not expensive multi-dimensional search)
- Maximum 20-30 iterations is sufficient
- 2% step size provides good balance of speed vs precision
- Stop when no improvement found

**3. Handle Edge Cases**:
- Routes with zero output must be skipped
- Ensure split percentages sum to 1.0 (normalize after adjustments)
- Minimum percentage per route (e.g., 1%) prevents numerical instability
- Maximum 10 routes to avoid combinatorial explosion

**4. Performance Considerations**:
- Discovery phase should be < 1 second
- Optimization should be < 3 seconds
- Total time budget: < 5 seconds for user experience
- If optimization takes too long, return best discovered route without splitting

**5. Validation**:
- Verify total output exceeds any single route (split should improve, not worsen)
- Ensure all routes in split have valid execution paths
- Check that combined gas costs don't exceed savings

#### Common Mistakes to Avoid

**❌ Linear Approximation**:
```javascript
// NEVER DO THIS
const scaledOutput = route.totalOutput.mul(routeAmount).div(totalAmount);
```

**❌ Ignoring Price Impact**:
```javascript
// WRONG - Assumes linear scaling
if (route gives 100 tokens for 1000 input) {
  assume route gives 50 tokens for 500 input  // NOT TRUE!
}
```

**❌ Using Cached Outputs**:
```javascript
// WRONG - Output was calculated for full amount
return route.outputAmount; // Don't use this for splits
```

**✅ Correct Approach**:
```javascript
// Recalculate for the actual split amount
const exactOutput = await calculateRouteExactOutput(route, splitAmount);
```

#### Latest Routing System Improvements (Completed)

The cross-DEX routing system has been significantly enhanced with the following features:

1. ✅ **Pool Deduplication by Pool Address**: Both Uniswap and Balancer paths are deduplicated by actual pool addresses (not output amounts) to prevent the same pool from being included multiple times in optimization.

2. ✅ **Per-Route Output Calculation**: Each multi-hop route now queries its second leg using its own first leg's specific output. Previously, all routes shared the same estimated output from the best first-leg pool, causing incorrect output calculations for weaker pools.

3. ✅ **Balancer Path Structure Handling**: Proper handling of Balancer's path structure (`pathResult.poolAddresses` and `pathResult.path.hops`) for reliable pool identification and deduplication.

4. ✅ **Uniswap Shows ETH (not WETH)**: Uniswap V4 routes correctly display and use ETH as the native token, while Balancer routes use WETH. The intermediate token is automatically selected based on protocol (`intermediate.isETH` flag).

5. ✅ **WETH → ETH Unwrap at 1:1**: Cross-DEX routes that bridge from Balancer (WETH) to Uniswap (ETH) now correctly show and handle the 1:1 unwrap operation, not a swap through a pool.

6. ✅ **3-Hop Routes Working Correctly**: Routes like AAVE → USDC → ETH → 1INCH are properly discovered and each leg calculates based on the actual output from the previous leg.

7. ✅ **Pool Convergence Detection**: The system detects when multiple routes converge to the same final pool (e.g., 5 routes all ending at ETH-1INCH pool) and logs a warning about potential compounding price impact.

8. ✅ **Optimizer Correctly Minimizes Bad Pools**: The hill-climbing optimizer now correctly allocates minimal percentage (e.g., 1.5%) to inferior pools while maximizing allocation to better pools, based on their actual calculated outputs.

**Example Results**:
- Input: 1000 AAVE → 1INCH
- Output: ~470,000 1INCH (vs. ~240,000 from single best route)
- Optimal split: 67% best pool, 1.5% worst pool, 13.6% USDC path, 13.3% 3-hop path, 4.6% Balancer path

#### Future Enhancements
- Parallel route execution via WalletBundler contract
- Dynamic route discovery during optimization
- Gas cost integration into optimization objective
- Multi-hop convergence path support (currently disabled due to performance)
- Hierarchical optimization to properly handle pool convergence

### Advanced Path Discovery and Pool Consolidation (Latest Optimizations)

#### 3-Hop Path Discovery Without ETH Restrictions

**Problem Solved**: Path discovery asymmetry where ONE→SEV found only 5 routes while SEV→ONE found 11 routes.

**Root Cause**: The 3-hop discovery code had `if (!intermediate.isETH)` restrictions at lines 694 and 944 that prevented discovering 3-hop paths when ETH/WETH was the first intermediate token.

**Fix Applied** (`useMixedUniswapBalancer.js`):
- Removed the `if (!intermediate.isETH)` condition from both Balancer-based and Uniswap-based 3-hop discovery sections
- Now discovers routes like ONE→ETH→EIG→SEV even when ETH is the first intermediate
- Both directions (ONE→SEV and SEV→ONE) now symmetrically discover all available 3-hop paths

**Impact**:
```javascript
// Before: ONE→SEV discovery skipped 3-hop routes
intermediates = [ETH, ONE, EIG, ...]
if (!intermediate.isETH) {  // ❌ Skips when intermediate is ETH
  // 3-hop discovery code
}

// After: ONE→SEV discovers all paths
intermediates = [ETH, ONE, EIG, ...]
// No restriction - always runs 3-hop discovery ✅
// Discovers: ONE→ETH→EIG→SEV, ONE→ETH→USDC→SEV, etc.
```

#### Pool Consolidation System

The optimization system implements intelligent pool filtering to reduce gas costs while maintaining optimal routing:

**1. Tiny Pool Filtering** (MIN_ALLOCATION = 0.02%)
- Pools with < 0.02% allocation are candidates for removal
- Exception: Kept if consumed by significant downstream pools (≥ 0.02%)
- Location: `buildPoolExecutionStructureFromGroups()` lines 3490-3520

**Logic**:
```javascript
if (percentageOfLevelInput < 0.0002) {  // < 0.02%
  // Check if downstream consumers have meaningful allocation
  const downstreamConsumers = findConsumersForToken(outputToken);

  if (hasSignificantConsumer >= 0.0002) {
    keepPool();  // Needed to feed significant downstream pool
  } else {
    skipPool();  // Wastes gas for negligible output
  }
}
```

**2. Orphaned Pool Removal** (Cascading Validation)
- After filtering, validates that each pool's input token is produced by previous levels
- Removes pools whose input source was filtered out
- Prevents impossible execution scenarios
- Location: `buildPoolExecutionStructureFromGroups()` lines 3800-3830

**Example**:
```javascript
// After filtering removes ONE→SEV (0.000% allocation):
Level 0: [pools producing ONE removed]
Level 1: SEV→ETH still present ❌

// Orphaned pool validation:
availableTokens = {initial input token}
for each level:
  for each pool:
    if (!availableTokens.has(pool.inputToken)) {
      remove pool;  // ✅ Removes SEV→ETH (no SEV source)
    }
  add pool.outputToken to availableTokens;
```

**3. Competing Output Token Consolidation**
- When multiple groups compete for same input token with different outputs
- Tiny competing outputs (< 0.02%) are consolidated into the largest output
- Their percentages are added to the dominant route
- Location: `buildPoolExecutionStructureFromGroups()` lines 3549-3622

**Example**:
```javascript
// Before consolidation:
Level 1: SEV→ETH (99.992%)
Level 1: SEV→EIG (0.008%)

// After consolidation:
Level 1: SEV→ETH (100.000%)  // ✅ Absorbed SEV→EIG allocation
// SEV→EIG removed (wasted gas for negligible gain)
```

**Benefits**:
- Reduces gas costs by eliminating negligible pools
- Maintains routing optimality (tiny pools don't significantly affect output)
- Prevents execution failures from orphaned token dependencies
- Ensures clean execution structure with meaningful allocations

#### Wrap/Unwrap Operation Display

**Problem Solved**: When Balancer outputs WETH and Uniswap needs ETH, the conversion wasn't visible:
```
Level 0: Balancer ONE → WETH
Level 1: Uniswap ETH → SEV
```
Users couldn't see how WETH became ETH!

**Fix Applied** (`useMixedUniswapBalancer.js` lines 3424-3433):
- Added wrap operation descriptions to pool execution structure display
- Shows explicit conversion operations inline with pool information

**New Display Format**:
```
Level 0:
  • balancer (0x1a2b3c...): ONE→WETH at 100.0% [Unwrap WETH→ETH after]

Level 1:
  • uniswap (0x4d5e6f...): ETH→SEV at 100.0%
```

**Wrap Operation Codes**:
- **[Wrap ETH→WETH before]**: wrapOp=1 - Balancer pool needs WETH input
- **[Wrap ETH→WETH after]**: wrapOp=2 - Uniswap outputs ETH but next level needs WETH
- **[Unwrap WETH→ETH before]**: wrapOp=3 - Uniswap pool needs ETH input
- **[Unwrap WETH→ETH after]**: wrapOp=4 - Balancer outputs WETH but next level needs ETH

**Implementation**:
```javascript
const wrapOpDescriptions = {
  1: ' [Wrap ETH→WETH before]',
  2: ' [Wrap ETH→WETH after]',
  3: ' [Unwrap WETH→ETH before]',
  4: ' [Unwrap WETH→ETH after]'
};
const wrapOpDesc = pool.wrapOperation ? wrapOpDescriptions[pool.wrapOperation] || '' : '';
```

**Detection Logic** (already existed, now visible):
- Input conversion: Checks if pool expects different form than provided (lines 3547-3555)
- Output conversion: Checks if next level consumers need different form (lines 3560-3596)
- Mixed consumption: Handles cases where multiple consuming pools need different forms
- Final output: Ensures user receives expected token form (ETH or WETH)

**Critical Cases Handled**:
1. **Cross-DEX Bridge**: Balancer (WETH) → Uniswap (ETH) - unwrap after Balancer
2. **Same Protocol Sequence**: Multiple Balancer hops maintain WETH without conversion
3. **Mixed Consumption**: Level produces WETH, some consumers need WETH, others need ETH - conversions happen at consumer input
4. **Final Output**: Always converts to user's expected token form

### Pool-Based Execution Architecture (CRITICAL)

**IMPORTANT**: After optimization, the system transitions from route-based thinking to pool-based execution. This is a fundamental architectural principle.

#### Optimization Phase Flow
```
1. Route Discovery
   ├─ Discovers multi-leg routes (e.g., AAVE → ETH → 1INCH)
   ├─ Each route has legs through specific pools
   └─ Multiple routes may use the same pools

2. Pool Convergence Detection
   ├─ Identifies pools used by multiple routes
   ├─ Detects execution dependencies (which pools must execute first)
   └─ Groups pools by convergence points

3. Pool Flattening & Sorting
   ├─ Flattens all routes into individual pools
   ├─ Analyzes token dependencies (inputToken → outputToken)
   ├─ Uses topological sort to determine execution levels
   └─ Computes percentage allocation per pool (not per route)

4. Output Structure
   └─ poolExecutionStructure: {
       levels: [
         { level: 0, pools: [{poolAddress, percentage, inputToken, outputToken}] },
         { level: 1, pools: [...] }
       ]
     }
```

#### Execution Plan Phase
```
Input: poolExecutionStructure from optimizer
Process:
├─ DOES NOT recalculate intermediate amounts
├─ DOES NOT re-detect convergence
├─ Simply converts pools to execution steps
└─ Executes level-by-level in correct order
```

#### Key Principles

**1. Pools Are the Only Entity**
- After optimization, routes and legs are discarded
- Only pools exist, each with:
  - Pool address/ID
  - Execution level (0, 1, 2...)
  - Percentage of input at that level
  - Input/output token pair
  - Protocol (uniswap/balancer)

**2. Execution Order Matters**
- Pools are sorted by level based on token dependencies
- Example: If pool B needs ETH and pool A produces ETH, then:
  - Level 0: Pool A executes
  - Level 1: Pool B executes (using output from A)

**3. Compound Input Calculation**
- At each level, compute input based on previous level outputs
- When multiple routes converge on a pool:
  - Sum the outputs from all feeding pools
  - This is the compound input for the converging pool
  - No pre-calculation needed - happens during execution

**4. No Redundant Calculations**
- Optimizer already computed optimal percentages
- Execution plan does NOT recalculate flows
- Intermediate amounts are determined at execution time

#### Example: AAVE → 1INCH with Multiple Paths

**Before Optimization (Routes)**:
```
Route 1: AAVE →[Pool A]→ ETH →[Pool C]→ 1INCH (30%)
Route 2: AAVE →[Pool B]→ ETH →[Pool C]→ 1INCH (70%)
```

**After Optimization (Pools)**:
```
Level 0:
  - Pool A (AAVE→ETH): 30% of initial input
  - Pool B (AAVE→ETH): 70% of initial input

Level 1:
  - Pool C (ETH→1INCH): 100% (receives compound output from A+B)
```

**Execution**:
```
1. Execute Pool A with 300 AAVE → get X ETH
2. Execute Pool B with 700 AAVE → get Y ETH
3. Execute Pool C with (X+Y) ETH → get final 1INCH
```

#### Implementation Files

**Optimizer** (`useMixedUniswapBalancer.js`):
- `buildPoolExecutionStructure()`: Flattens routes into pool structure (line ~1017)
- `optimizeSplitSimple()`: Builds and attaches pool structure to result (line ~1362)

**Execution Plan** (`executionPlan.js`):
- Receives `route.poolExecutionStructure` (line ~186)
- Converts pool levels to execution steps (line ~196)
- NO intermediate flow calculation
- NO convergence re-detection

#### Common Mistakes to Avoid

**❌ Thinking in Routes/Legs**:
```javascript
// WRONG - Execution plan should not iterate over route.splits[i].route.legs
for (const split of route.splits) {
  for (const leg of split.route.legs) {
    // This is route-based thinking
  }
}
```

**✅ Thinking in Pools**:
```javascript
// CORRECT - Iterate over pool execution levels
for (const level of route.poolExecutionStructure.levels) {
  for (const pool of level.pools) {
    // Execute this pool with its percentage
  }
}
```

**❌ Recalculating Intermediate Amounts**:
```javascript
// WRONG - Don't calculate flows in execution plan
const flow = await calculateBalancerRouteOutput(leg, amount);
```

**✅ Using Optimizer's Percentages**:
```javascript
// CORRECT - Use pre-computed percentages
const poolInput = totalInput * pool.percentage;
```

### CRITICAL: Uniswap Route Discovery Constraints

**IMPORTANT LIMITATION**: The current Uniswap integration (`useUniswap.selectBestPath`) ONLY returns 1-hop trades (single pool swaps).

**Key Facts**:
- **No Multi-Hop**: Only direct token0 → token1 swaps through a single pool
- **No Pre-Optimized Splits**: When multiple routes are returned, they are NOT a pre-split allocation
- **Multiple Routes = Different Pools**: Each route represents a different pool, ALL evaluated with the FULL input amount
- **Example**:
  ```
  Route 1: 14.203 ETH output (Input: 1000.0 AAVE, Pool A)
  Route 2: 0.441 ETH output (Input: 1000.0 AAVE, Pool B)
  ```
  Both routes calculated for the **full 1000 AAVE**, not a split!

**Cross-DEX Implication**:
When building multi-hop cross-DEX routes (e.g., AAVE → ETH → 1INCH), the system must:
1. Find ALL single-hop routes to intermediate token (e.g., all AAVE → ETH pools)
2. Optimize the split across these routes to maximize intermediate output
3. Use the maximized combined output for the second leg

**DO NOT**:
- Assume `selectBestPath` returns pre-split amounts
- Sum route outputs without considering they all need the same input
- Use only the best single route (wastes available liquidity in other pools)

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
- **Configurable Loss Protection**: USD value comparison before execution to prevent excessive losses (configurable percentage, default 20%)
- **Automatic Order Logic**: Buy levels use `shouldSwitchTokensForLimit: true`, sell levels use `false`
- **Execution Function**: `tryExecutePendingOrder()` handles all execution logic with proper error handling

### Dollar-Based Price Limits (`limitPriceInDollars`)
- **Storage**: `triggerPrice` stores user input (dollars when true, token ratios when false)
- **Conversion**: Dollar prices converted to token ratios for DEX execution (`dollarPrice / tokenBPrice`)
- **Trigger Logic**: All price comparisons convert to same units - prevents mixing dollars with token ratios
- **Critical**: Applied across all execution paths to ensure coherent unit comparisons

### Dynamic Encoding Architecture (New Implementation)

#### Overview
The system now uses encoder contracts that generate swap calldata dynamically based on actual token balances, solving slippage accumulation in multi-hop trades.

#### Encoder Contracts
- **UniswapEncoder.sol**: Encodes Uniswap V4 Universal Router calls
- **BalancerEncoder.sol**: Encodes Balancer V3 Vault calls
- **Key Functions**:
  - `encodeSingleSwap()`: Standard swap with exact amounts
  - `encodeMultiHopSwap()`: Multi-pool routing (Uniswap only)
  - `encodeBatchSwap()`: Multi-pool routing (Balancer only)
  - `encodeUseAllBalanceSwap()`: Uses type(uint256).max marker for "use all" logic

#### WalletBundler encodeAndExecute Method
```solidity
function encodeAndExecute(
    address fromToken,
    uint256 fromAmount,
    address[] calldata encoderTargets,    // Encoder contracts
    bytes[] calldata encoderData,         // Encoder function calls
    uint8[] calldata wrapOperations,      // Wrap/unwrap codes
    uint256 minOutputAmount
) external payable auth returns (bool[] memory results)
```

#### Wrap/Unwrap Operation Codes
- **0**: No operation
- **1**: Wrap all ETH to WETH before call
- **2**: Wrap all ETH to WETH after call
- **3**: Unwrap all WETH to ETH before call
- **4**: Unwrap all WETH to ETH after call

#### Smart Split Detection (JavaScript)
The `markSplitLegs()` function analyzes execution plans to determine when steps should use exact amounts vs all balance:

**Parallel Split Pattern** (same intermediate token):
```
Step 1: TokenA → TokenB (50% via Uniswap) - exact amount
Step 2: TokenA → TokenB (50% via Balancer) - use all remaining
Step 3: TokenB → TokenC (100% combined) - use all balance
```

**Divergent Path Pattern** (different intermediate tokens):
```
Step 1: TokenA → TokenB (50% via path 1) - exact amount
Step 2: TokenA → TokenD (50% via path 2) - use all remaining
Step 3: TokenB → TokenC (from path 1) - use all TokenB
Step 4: TokenD → TokenC (from path 2) - use all TokenD
```

#### Slippage Handling Strategy
- **First Hop**: Uses exact split amounts (except last leg uses "all remaining")
- **Intermediate Hops**: Always use entire balance (absorbs slippage)
- **Final Hop**: Enforces minimum output requirement
- **Result**: Slippage doesn't accumulate, only affects final output

#### Benefits Over Static Execution
1. **Slippage Resilience**: Each hop adapts to actual received amounts
2. **No Rounding Errors**: Last split leg uses all remaining balance
3. **Atomic Execution**: All swaps still execute in single transaction
4. **Gas Efficiency**: Final output sent directly to user

#### Example Execution Flow
```javascript
// Input: 1000 USDC split 60/40 between Uniswap/Balancer
const plan = [
  {
    encoder: uniswapEncoder,
    data: encodeSingleSwap(USDC, WETH, 600, ...),  // Exact 600
    wrapOp: 0
  },
  {
    encoder: balancerEncoder,
    data: encodeUseAllBalanceSwap(USDC, WETH, ...),  // Use remaining ~400
    wrapOp: 0
  },
  {
    encoder: uniswapEncoder,
    data: encodeUseAllBalanceSwap(WETH, DAI, ...),  // Use all WETH
    wrapOp: 0
  }
];
// Result: Optimal routing with automatic slippage absorption
```