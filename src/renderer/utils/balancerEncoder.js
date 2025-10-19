import { ethers } from 'ethers';

// Balancer V3 Router address
const BALANCER_ROUTER = '0xAE563E3f8219521950555F5962419C8919758Ea2';
const DEADLINE = ethers.constants.MaxUint256;

/**
 * Encodes Balancer swapSingleTokenExactIn directly in JavaScript
 * @param {string} pool - Pool address
 * @param {string} tokenIn - Input token address
 * @param {string} tokenOut - Output token address
 * @param {ethers.BigNumber} exactAmountIn - Exact input amount
 * @param {ethers.BigNumber} minAmountOut - Minimum output amount
 * @returns {Object} { target, data } - Router address and encoded calldata
 */
export function encodeBalancerSwap(pool, tokenIn, tokenOut, exactAmountIn, minAmountOut) {
    const iface = new ethers.utils.Interface([
        'function swapSingleTokenExactIn(address pool, address tokenIn, address tokenOut, uint256 exactAmountIn, uint256 minAmountOut, uint256 deadline, bool wethIsEth, bytes userData) external returns (uint256)'
    ]);

    const data = iface.encodeFunctionData('swapSingleTokenExactIn', [
        pool,
        tokenIn,
        tokenOut,
        exactAmountIn,
        minAmountOut,
        DEADLINE,
        false,  // wethIsEth = false
        '0x'    // empty userData
    ]);

    return {
        target: BALANCER_ROUTER,
        data
    };
}

/**
 * Creates encoder call for USE_ALL balance swap
 * @param {string} balancerEncoderAddress - Deployed BalancerEncoder contract address
 * @param {string} pool - Pool address
 * @param {string} tokenIn - Input token address
 * @param {string} tokenOut - Output token address
 * @param {ethers.BigNumber} minAmountOut - Minimum output amount
 * @param {number} wrapOp - Wrap operation code (0=none, 1=wrap ETH, 3=unwrap WETH)
 * @returns {Object} { encoderTarget, encoderData }
 */
export function createBalancerUseAllStep(balancerEncoderAddress, pool, tokenIn, tokenOut, minAmountOut, wrapOp) {
    const iface = new ethers.utils.Interface([
        'function encodeUseAllBalanceSwap(address pool, address tokenIn, address tokenOut, uint256 minAmountOut, uint8 wrapOp) external view returns (address target, bytes callData, uint256 inputAmount, address)'
    ]);

    const encoderData = iface.encodeFunctionData('encodeUseAllBalanceSwap', [
        pool,
        tokenIn,
        tokenOut,
        minAmountOut,
        wrapOp
    ]);

    return {
        encoderTarget: balancerEncoderAddress,
        encoderData
    };
}

export { BALANCER_ROUTER };
