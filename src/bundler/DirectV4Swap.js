/**
 * DirectV4Swap - Helper for executing swaps directly via PoolManager (bypassing Universal Router)
 * This solves the issue where Universal Router reverts on ERC20 swaps with "exttload returns 0"
 */

const { ethers } = require('ethers');

class DirectV4Swap {
    constructor(walletBundlerContract, poolManagerAddress) {
        this.bundler = walletBundlerContract;
        this.poolManager = poolManagerAddress || '0x000000000004444c5dc75cB358380D2e3dE08A90';
    }

    /**
     * Execute a direct V4 swap via PoolManager
     * @param {Object} params Swap parameters
     * @param {string} params.fromToken - Input token address (use ethers.constants.AddressZero for ETH)
     * @param {BigNumber} params.fromAmount - Input amount
     * @param {string} params.toToken - Output token address (use ethers.constants.AddressZero for ETH)
     * @param {Object} params.poolKey - Uniswap V4 pool parameters
     * @param {string} params.poolKey.currency0 - Pool currency0 address
     * @param {string} params.poolKey.currency1 - Pool currency1 address
     * @param {number} params.poolKey.fee - Pool fee tier (e.g., 3000 for 0.3%)
     * @param {number} params.poolKey.tickSpacing - Pool tick spacing
     * @param {string} params.poolKey.hooks - Hooks contract address (use AddressZero if none)
     * @param {boolean} params.zeroForOne - Swap direction (true = currency0→currency1)
     * @param {BigNumber} params.minOutputAmount - Minimum acceptable output
     * @param {number} params.sqrtPriceLimitX96 - Price limit (use 0 for no limit)
     * @returns {Promise<Object>} Transaction result with outputAmount
     */
    async executeSwap(params) {
        const {
            fromToken,
            fromAmount,
            toToken,
            poolKey,
            zeroForOne,
            minOutputAmount,
            sqrtPriceLimitX96 = 0
        } = params;

        // Convert amount to negative for "exact input" swap
        const amountSpecified = ethers.BigNumber.from(fromAmount).mul(-1);

        // Determine msg.value (ETH amount to send)
        const msgValue = fromToken === ethers.constants.AddressZero ? fromAmount : 0;

        console.log('📤 Executing Direct V4 Swap:');
        console.log(`   From: ${fromToken === ethers.constants.AddressZero ? 'ETH' : fromToken}`);
        console.log(`   To: ${toToken === ethers.constants.AddressZero ? 'ETH' : toToken}`);
        console.log(`   Amount In: ${ethers.utils.formatUnits(fromAmount, 18)}`);
        console.log(`   Min Output: ${ethers.utils.formatUnits(minOutputAmount, 18)}`);
        console.log(`   Direction: ${zeroForOne ? 'currency0→currency1' : 'currency1→currency0'}`);
        console.log(`   Pool Fee: ${poolKey.fee / 10000}%`);

        try {
            const tx = await this.bundler.swapDirectV4(
                fromToken,
                fromAmount,
                toToken,
                poolKey,
                zeroForOne,
                amountSpecified,
                sqrtPriceLimitX96,
                minOutputAmount,
                { value: msgValue }
            );

            console.log(`   Tx Hash: ${tx.hash}`);
            console.log('   Waiting for confirmation...');

            const receipt = await tx.wait();
            console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
            console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);

            // Try to extract output amount from events
            const outputAmount = await this._extractOutputAmount(receipt, toToken);
            if (outputAmount) {
                console.log(`   Output Amount: ${ethers.utils.formatUnits(outputAmount, 18)}`);
            }

            return {
                success: true,
                tx: tx,
                receipt: receipt,
                outputAmount: outputAmount,
                gasUsed: receipt.gasUsed
            };

        } catch (error) {
            console.error('❌ Direct V4 Swap Failed:');
            console.error(`   Error: ${error.message}`);

            // Try to extract revert reason
            if (error.error && error.error.data) {
                console.error(`   Revert Data: ${error.error.data}`);
            }

            return {
                success: false,
                error: error.message,
                errorData: error.error?.data
            };
        }
    }

    /**
     * Helper to extract output amount from transaction receipt
     * @private
     */
    async _extractOutputAmount(receipt, toToken) {
        try {
            // Look for Transfer events to the owner
            const owner = await this.bundler.owner();

            for (const log of receipt.logs) {
                // Transfer event signature: Transfer(address,address,uint256)
                if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                    const to = ethers.utils.defaultAbiCoder.decode(['address'], log.topics[2])[0];
                    if (to.toLowerCase() === owner.toLowerCase()) {
                        const amount = ethers.utils.defaultAbiCoder.decode(['uint256'], log.data)[0];
                        return amount;
                    }
                }
            }
            return null;
        } catch (error) {
            console.warn('Could not extract output amount:', error.message);
            return null;
        }
    }

    /**
     * Build pool key from token addresses and fee tier
     * Automatically determines currency0/currency1 order
     */
    static buildPoolKey(tokenA, tokenB, fee, tickSpacing, hooks = ethers.constants.AddressZero) {
        // Sort tokens to determine currency0 and currency1
        const [currency0, currency1] = tokenA.toLowerCase() < tokenB.toLowerCase()
            ? [tokenA, tokenB]
            : [tokenB, tokenA];

        return {
            currency0,
            currency1,
            fee,
            tickSpacing,
            hooks
        };
    }

    /**
     * Determine swap direction based on input token and pool currencies
     */
    static getSwapDirection(inputToken, poolKey) {
        return inputToken.toLowerCase() === poolKey.currency0.toLowerCase();
    }

    /**
     * Get standard tick spacing for fee tier
     */
    static getTickSpacing(fee) {
        const tickSpacings = {
            100: 1,      // 0.01%
            500: 10,     // 0.05%
            2500: 50,    // 0.25%
            3000: 60,    // 0.3%
            10000: 200   // 1%
        };
        return tickSpacings[fee] || 60; // Default to 60
    }
}

module.exports = DirectV4Swap;
