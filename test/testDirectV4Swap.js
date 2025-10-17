/**
 * Test script for Direct V4 Swap (bypassing Universal Router)
 * This demonstrates how to execute AAVE→ETH swap that was previously failing
 */

const { ethers } = require('hardhat');
const DirectV4Swap = require('../src/bundler/DirectV4Swap');

async function main() {
    console.log('\n🧪 Testing Direct V4 Swap via PoolManager\n');
    console.log('=' .repeat(80));

    // Get signer
    const [owner] = await ethers.getSigners();
    console.log(`Owner: ${owner.address}`);
    console.log(`Balance: ${ethers.utils.formatEther(await owner.getBalance())} ETH\n`);

    // Token addresses
    const AAVE = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    const ETH = ethers.constants.AddressZero;

    // Get WalletBundler contract (you need to deploy it first or use existing)
    const WalletBundler = await ethers.getContractFactory('WalletBundler');

    // Option 1: Deploy new bundler
    console.log('Deploying WalletBundler...');
    const bundler = await WalletBundler.deploy();
    await bundler.deployed();
    console.log(`✅ WalletBundler deployed at: ${bundler.address}\n`);

    // Option 2: Connect to existing bundler
    // const bundler = WalletBundler.attach('0xYourBundlerAddress');

    // Create DirectV4Swap helper
    const directSwap = new DirectV4Swap(bundler);

    // ========================================================================
    // Test 1: AAVE → ETH (this was failing with Universal Router)
    // ========================================================================
    console.log('Test 1: AAVE → ETH Swap');
    console.log('-'.repeat(80));

    // First, we need AAVE tokens - get them from a holder or swap ETH for them
    const aaveAmount = ethers.utils.parseUnits('100', 18); // 100 AAVE

    // Build pool key for AAVE/ETH pool
    // Note: V4 uses address(0) for ETH, not WETH
    const poolKey = DirectV4Swap.buildPoolKey(
        AAVE,
        ETH,
        3000,  // 0.3% fee tier
        DirectV4Swap.getTickSpacing(3000)
    );

    console.log('Pool Key:');
    console.log(`  currency0: ${poolKey.currency0}`);
    console.log(`  currency1: ${poolKey.currency1}`);
    console.log(`  fee: ${poolKey.fee}`);
    console.log(`  tickSpacing: ${poolKey.tickSpacing}`);
    console.log(`  hooks: ${poolKey.hooks}\n`);

    // Determine swap direction
    const zeroForOne = DirectV4Swap.getSwapDirection(AAVE, poolKey);
    console.log(`Swap Direction: ${zeroForOne ? 'AAVE→ETH' : 'ETH→AAVE'}\n`);

    // Approve AAVE for WalletBundler (if needed)
    const aaveToken = await ethers.getContractAt('IERC20', AAVE);
    const allowance = await aaveToken.allowance(owner.address, bundler.address);
    if (allowance.lt(aaveAmount)) {
        console.log('Approving AAVE...');
        const approveTx = await aaveToken.approve(bundler.address, ethers.constants.MaxUint256);
        await approveTx.wait();
        console.log('✅ AAVE approved\n');
    }

    // Calculate minimum output (with 1% slippage tolerance)
    const expectedOutput = ethers.utils.parseEther('0.03'); // Adjust based on current price
    const minOutputAmount = expectedOutput.mul(99).div(100); // 1% slippage

    // Execute swap
    const result = await directSwap.executeSwap({
        fromToken: AAVE,
        fromAmount: aaveAmount,
        toToken: ETH,
        poolKey: poolKey,
        zeroForOne: zeroForOne,
        minOutputAmount: minOutputAmount,
        sqrtPriceLimitX96: 0 // No price limit
    });

    if (result.success) {
        console.log('\n✅ Swap Successful!');
        console.log(`   Output: ${ethers.utils.formatEther(result.outputAmount || 0)} ETH`);
        console.log(`   Gas Used: ${result.gasUsed.toString()}`);
    } else {
        console.log('\n❌ Swap Failed!');
        console.log(`   Error: ${result.error}`);
    }

    // ========================================================================
    // Test 2: ETH → AAVE (this should work with both methods)
    // ========================================================================
    console.log('\n\nTest 2: ETH → AAVE Swap');
    console.log('-'.repeat(80));

    const ethAmount = ethers.utils.parseEther('0.1'); // 0.1 ETH

    // Same pool, opposite direction
    const zeroForOne2 = DirectV4Swap.getSwapDirection(ETH, poolKey);
    console.log(`Swap Direction: ${zeroForOne2 ? 'ETH→AAVE' : 'AAVE→ETH'}\n`);

    const minOutputAmount2 = ethers.utils.parseUnits('3', 18); // Minimum 3 AAVE

    const result2 = await directSwap.executeSwap({
        fromToken: ETH,
        fromAmount: ethAmount,
        toToken: AAVE,
        poolKey: poolKey,
        zeroForOne: zeroForOne2,
        minOutputAmount: minOutputAmount2,
        sqrtPriceLimitX96: 0
    });

    if (result2.success) {
        console.log('\n✅ Swap Successful!');
        console.log(`   Output: ${ethers.utils.formatUnits(result2.outputAmount || 0, 18)} AAVE`);
        console.log(`   Gas Used: ${result2.gasUsed.toString()}`);
    } else {
        console.log('\n❌ Swap Failed!');
        console.log(`   Error: ${result2.error}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Direct V4 Swap Testing Complete\n');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
