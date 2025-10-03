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

#### Protocol Return Values
The `bestTrade` routing system can return one of four protocol identifiers:
- **"Uniswap"**: Direct Uniswap V4 execution via Universal Router
- **"Balancer"**: Direct Balancer V3 execution via Vault contract
- **"Contract"**: WalletBundler contract execution for MEV-protected multi-DEX atomic trades
- **"1inch"**: 1inch aggregator integration (limited use due to API restrictions)

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
  const wallet = getWallet(walletAddress.toLowerCase(), true);
  const bundlerManager = new BundlerManager(provider, wallet);
  const bundlerContract = await bundlerManager.deployBundler(salt);
  return { success: true, address: bundlerContract.address };
});

ipcMain.handle('get-bundler', async (event, walletAddress) => {
  const wallet = getWallet(walletAddress.toLowerCase(), true);
  const bundlerManager = new BundlerManager(provider, wallet);
  const bundlerContract = await bundlerManager.getBundler(walletAddress);
  return { success: true, address: bundlerContract ? bundlerContract.address : null };
});
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
// Deploy button in template
<button
  v-if="!contractAddress?.[senderDetails?.address]"
  @click="deployBundler"
  :disabled="isDeploying"
>
  {{ isDeploying ? 'Deploying...' : 'Deploy' }}
</button>

// Deployment function
const deployBundler = async () => {
  isDeploying.value = true;
  swapMessage.value = 'Deploying bundler contract...';

  const result = await window.electronAPI.deployBundler(senderDetails.value.address);

  if (result.success && result.address) {
    contractAddress[senderDetails.value.address] = result.address;
    swapMessage.value = 'Bundler deployed successfully!';
  }
};
```

#### Contract Address Storage

**In-Memory Storage** (`ManualTrading.vue:697`):
```javascript
const contractAddress = reactive({});  // Keyed by wallet address
```

**Initialization on Mount** (`ManualTrading.vue:5058-5064`):
```javascript
// Check for existing bundler
if (senderDetails.value?.address) {
  const result = await window.electronAPI.getBundler(senderDetails.value.address);
  if (result.success && result.address) {
    contractAddress[senderDetails.value.address] = result.address;
  }
}
```

**Display in UI**:
- Shows "Deploy" button when no bundler exists for current wallet
- Shows bundler address with copy functionality when deployed
- Address format: `0x1234...5678` (shortened for display)

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

**IPC Security**:
- `contextBridge` prevents direct access to Node.js APIs
- Only whitelisted functions exposed to renderer
- All parameters validated in main process handlers
- Error messages sanitized before returning to renderer

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
- `encodeBatchSwap`: Encodes multi-hop Balancer paths
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

### 1inch Integration Analysis
- **API Limitations**: 1 RPS rate limit on basic tier, registration required since 2023
- **No Platform Fees**: 1inch doesn't charge trading fees, only captures rare positive slippage (~1%)
- **Direct Contract Usage**: Technically possible but impractical due to proprietary routing algorithm
- **Recommendation**: Use direct DEX integration instead of 1inch aggregation

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
  - `crossDEXOptimizer.js`: Exact AMM calculations for both protocols
  - `testCrossDEXRouting.js`: Test file with target values for validation

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