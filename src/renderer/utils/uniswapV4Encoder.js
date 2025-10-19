/**
 * @title Uniswap V4 Unlock Callback Encoder
 * @notice Pure JavaScript encoding for maximum efficiency
 * @dev Encodes unlock callback format directly - zero contract calls needed!
 */

import { ethers } from 'ethers';

// Constants
const UNIVERSAL_ROUTER = '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af';
const MIN_SQRT_PRICE_LIMIT = '4295128740';
const MAX_SQRT_PRICE_LIMIT = '1461446703485210103287273052203988822378723970341';

/**
 * Encode Uniswap V4 swap with exact amount (Pure JavaScript - No contract call!)
 * @param {string} tokenIn - Input token address (use ethers.constants.AddressZero for ETH)
 * @param {string} tokenOut - Output token address
 * @param {Object} poolKey - Pool parameters { currency0, currency1, fee, tickSpacing, hooks }
 * @param {string|BigNumber} amountIn - Exact input amount
 * @param {string|BigNumber} minAmountOut - Minimum output amount
 * @returns {Object} { target, data, inputAmount, tokenIn }
 */
function encodeUniswapV4Swap(tokenIn, tokenOut, poolKey, amountIn, minAmountOut) {
    // Determine swap direction
    const zeroForOne = tokenIn === poolKey.currency0 || tokenIn === ethers.constants.AddressZero;

    // Select appropriate price limit
    const sqrtPriceLimitX96 = zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT;

    // Encode unlock callback format
    const unlockData = ethers.utils.defaultAbiCoder.encode(
        [
            'address',                                      // tokenIn
            'address',                                      // tokenOut
            'tuple(address,address,uint24,int24,address)', // PoolKey
            'tuple(bool,int256,uint160)',                  // SwapParams
            'uint256'                                       // minAmountOut
        ],
        [
            tokenIn,
            tokenOut,
            [
                poolKey.currency0,
                poolKey.currency1,
                poolKey.fee,
                poolKey.tickSpacing,
                poolKey.hooks
            ],
            [
                zeroForOne,
                ethers.BigNumber.from(amountIn).mul(-1),  // Negative for exact input
                sqrtPriceLimitX96
            ],
            minAmountOut
        ]
    );

    return {
        target: UNIVERSAL_ROUTER,
        data: unlockData,
        inputAmount: ethers.BigNumber.from(amountIn),
        tokenIn: tokenIn
    };
}

/**
 * Encode Uniswap V4 swap using all available balance (requires UniswapEncoder contract)
 * @param {Contract} uniswapEncoder - UniswapEncoder contract instance
 * @param {string} walletAddress - Wallet address (for balance query)
 * @param {string} tokenIn - Input token address
 * @param {Object} poolKey - Pool parameters
 * @param {string|BigNumber} minAmountOut - Minimum output amount
 * @param {number} wrapOp - Wrap operation code (0=none, 1=wrap before, 3=unwrap before)
 * @returns {Promise<Object>} { target, data, inputAmount, tokenIn }
 */
async function encodeUniswapV4UseAllBalance(
    uniswapEncoder,
    walletAddress,
    tokenIn,
    poolKey,
    minAmountOut,
    wrapOp = 0
) {
    const zeroForOne = tokenIn === poolKey.currency0 || tokenIn === ethers.constants.AddressZero;

    const swapParams = {
        poolKey: {
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: poolKey.fee,
            tickSpacing: poolKey.tickSpacing,
            hooks: poolKey.hooks
        },
        zeroForOne: zeroForOne,
        minAmountOut: ethers.BigNumber.from(minAmountOut),
        wrapOp: wrapOp,
        tokenIn: tokenIn
    };

    // Call encoder with staticcall (no gas cost, queries balance)
    const result = await uniswapEncoder.callStatic.encodeUseAllBalanceSwap(
        swapParams,
        { from: walletAddress }
    );

    return {
        target: result.target,
        data: result.callData,
        inputAmount: result.inputAmount,
        tokenIn: result._tokenIn
    };
}

/**
 * Create execution step for exact amount Uniswap swap
 * @param {string} tokenIn - Input token address
 * @param {string} tokenOut - Output token address
 * @param {Object} poolKey - Pool parameters
 * @param {string|BigNumber} amountIn - Exact input amount
 * @param {string|BigNumber} minAmountOut - Minimum output amount
 * @param {number} wrapOp - Wrap operation code (default: 0)
 * @returns {Object} Execution step for WalletBundler encodeAndExecute
 */
function createUniswapV4Step(tokenIn, tokenOut, poolKey, amountIn, minAmountOut, wrapOp = 0) {
    const { data } = encodeUniswapV4Swap(
        tokenIn,
        tokenOut,
        poolKey,
        amountIn,
        minAmountOut
    );

    return {
        encoderTarget: ethers.constants.AddressZero,  // Flag: data is already unlock format
        encoderData: data,                             // Unlock callback format (pre-encoded in JS)
        wrapOp: wrapOp
    };
}

/**
 * Create execution step for use-all-balance Uniswap swap
 * @param {string} uniswapEncoderAddress - UniswapEncoder contract address
 * @param {string} tokenIn - Input token address
 * @param {Object} poolKey - Pool parameters
 * @param {string|BigNumber} minAmountOut - Minimum output amount
 * @param {number} wrapOp - Wrap operation code (default: 0)
 * @returns {Object} Execution step for WalletBundler encodeAndExecute
 */
function createUniswapV4UseAllStep(
    uniswapEncoderAddress,
    tokenIn,
    poolKey,
    minAmountOut,
    wrapOp = 0
) {
    const zeroForOne = tokenIn === poolKey.currency0 || tokenIn === ethers.constants.AddressZero;

    // Encode call to UniswapEncoder.encodeUseAllBalanceSwap
    const iface = new ethers.utils.Interface([
        'function encodeUseAllBalanceSwap(tuple(tuple(address,address,uint24,int24,address) poolKey, bool zeroForOne, uint256 minAmountOut, uint8 wrapOp, address tokenIn) swapParams) external view returns (address target, bytes callData, uint256 inputAmount, address _tokenIn)'
    ]);

    const encoderData = iface.encodeFunctionData('encodeUseAllBalanceSwap', [
        {
            poolKey: [
                poolKey.currency0,
                poolKey.currency1,
                poolKey.fee,
                poolKey.tickSpacing,
                poolKey.hooks
            ],
            zeroForOne: zeroForOne,
            minAmountOut: minAmountOut,
            wrapOp: wrapOp,
            tokenIn: tokenIn
        }
    ]);

    return {
        encoderTarget: uniswapEncoderAddress,  // Call UniswapEncoder contract
        encoderData: encoderData,               // Encoded call to encodeUseAllBalanceSwap
        wrapOp: wrapOp
    };
}

export {
    encodeUniswapV4Swap,
    encodeUniswapV4UseAllBalance,
    createUniswapV4Step,
    createUniswapV4UseAllStep,
    UNIVERSAL_ROUTER
};
