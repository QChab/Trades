// fetchV4Quote.js
// Single-hop quote on Uniswap V4 using @uniswap/v4-sdk + ethers v5
// npm install @uniswap/v4-sdk ethers@^5.0.0

// -- 1. Ethers v5 imports:
//    - `providers` namespace for all provider types (JsonRpcProvider, etc.)
//    - `Contract` class to interact with on-chain contracts
//    - `utils` namespace for hashing, encoding, unit parsing, CREATE2, etc.
//    - `constants` for common addresses like AddressZero
import { Contract, utils, constants } from 'ethers';
import provider from './../ethersProvider'

// -- 2. Uniswap v4 SDK imports:
//    - Core types (ChainId, Token, Pool, Route, Trade, TradeType, FeeAmount)
//    - Factory address & init code hash constants
import {
  Pool,
  Route,
  Trade,
  TradeType,
} from '@uniswap/v4-sdk';

// NOTE: this import of constant doesnt work because the constants file doesn't seem to exist in uniswap
import {
  FeeAmount,
  POOL_FACTORY_ADDRESS,
  POOL_INIT_CODE_HASH
} from '@uniswap/v4-sdk/dist/constants'


import { ChainId, Token } from '@uniswap/sdk-core'

// -- 3. Minimal ABI for Uniswap V4 pool interactions
const IUniswapV4PoolABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function tickSpacing() view returns (int24)',
  'function hooks() view returns (address)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 , uint16 , uint16 , uint8 , bool )'
];

// -- 4. Destructure commonly used utilities & constants:
//    - keccak256: for CREATE2 salt hashing
//    - getCreate2Address: compute pool address
//    - defaultAbiCoder: encode constructor salt values
//    - parseUnits: convert human input to BigNumber wei
//    - AddressZero: canonical zero address
const { keccak256, getCreate2Address, defaultAbiCoder, parseUnits } = utils;
const { AddressZero } = constants;

/**
 * fetchV4Quote
 * -------------
 * Fetches the best single-hop swap quote on Uniswap V4 for a given token pair and input amount.
 *
 * @param {string} rpcUrl            - RPC endpoint URL for Ethereum mainnet
 * @param {string} tokenInAddress    - ERC20 token address to swap from
 * @param {string} tokenOutAddress   - ERC20 token address to swap to
 * @param {string|number} amountInRaw- Human-readable input amount (e.g. "1.5" or 2)
 *
 * @returns {Trade}                  - Best Trade object from @uniswap/v4-sdk
 *
 * @throws {Error}                   - If no pool with liquidity is found for any fee tier
 */
export async function fetchV4Quote(tokenInAddress, tokenOutAddress, amountInRaw) {
  // -- B. Define the chain & wrap the token addresses into SDK Token instances
  const chainId  = ChainId.MAINNET;
  const tokenIn  = new Token(chainId, tokenInAddress, 18);
  const tokenOut = new Token(chainId, tokenOutAddress, 18);

  // -- C. Fee tiers to probe, from lowest to highest
  const feesToTry = [FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH];

  // Track best trade found so far (highest output amount)
  let bestTrade = null;

  // -- D. Iterate fee tiers
  for (const fee of feesToTry) {
    // 1) Compute the pool address deterministically via CREATE2
    const factoryAddr  = POOL_FACTORY_ADDRESS[chainId];
    const initCodeHash = POOL_INIT_CODE_HASH[chainId];

    // Sort tokens by address to match Uniswap convention
    const [A, B] = tokenIn.sortsBefore(tokenOut)
      ? [tokenIn, tokenOut]
      : [tokenOut, tokenIn];

    // Encode the pool salt fields: token0, token1, fee, tickSpacing, hooks
    const encoded = defaultAbiCoder.encode(
      ['address','address','uint24','int24','address'],
      [A.address, B.address, fee, Pool.getTickSpacing(fee), AddressZero]
    );
    // Hash for CREATE2 salt
    const salt = keccak256(encoded);
    // Compute pool address
    const poolAddress = getCreate2Address(factoryAddr, salt, initCodeHash);

    // 2) Fetch on-chain pool state via ethers.Contract
    const pc = new Contract(poolAddress, IUniswapV4PoolABI, provider);
    let immutables, state;
    try {
      // Read immutable params in parallel
      immutables = await Promise.all([
        pc.token0(),
        pc.token1(),
        pc.fee(),
        pc.tickSpacing(),
        pc.hooks()
      ]);
      // Read dynamic state: liquidity & current sqrtPrice/tick
      const liquidity = await pc.liquidity();
      const slot0     = await pc.slot0();
      state = {
        liquidity,
        sqrtPriceX96: slot0.sqrtPriceX96,
        tick:         slot0.tick
      };
    } catch {
      // Pool doesn't exist or no liquidity → skip this fee tier
      continue;
    }

    // 3) Instantiate an SDK Pool object
    const pool = new Pool({
      token0:       new Token(chainId, immutables[0], 18),
      token1:       new Token(chainId, immutables[1], 18),
      fee:          Number(immutables[2]),
      tickSpacing:  Number(immutables[3]),
      hooks:        immutables[4],
      sqrtPriceX96: state.sqrtPriceX96,
      liquidity:    state.liquidity,
      tick:         state.tick
    });

    // 4) Build a Route + exact-input Trade
    const route    = new Route([pool], tokenIn, tokenOut);
    const amountIn = parseUnits(amountInRaw.toString(), tokenIn.decimals);
    const trade    = await Trade.fromRoute(route, amountIn, TradeType.EXACT_INPUT);

    // 5) Update bestTrade if this one yields more output
    if (!bestTrade || trade.outputAmount.quotient.gt(bestTrade.outputAmount.quotient)) {
      bestTrade = trade;
    }
  }

  // If no trade was found across any fee tier, error out
  if (!bestTrade) {
    throw new Error('No V4 pool with liquidity found for provided tokens.');
  }

  // Log details for debugging
  console.log(`→ Best fee tier: ${bestTrade.route.pools[0].fee / 10000}%`);
  console.log(`→ Expected output: ${bestTrade.outputAmount.toExact()}`);

  return bestTrade;
}

// -- 5. Exports:
//    - Named export for selective imports
//    - Default export for simpler import syntax
export default fetchV4Quote