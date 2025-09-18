import OdosAPI from './OdosAPI.js';
import { ethers } from 'ethers';

async function testOdosAPI() {
  const odosAPI = new OdosAPI();
  
  console.log('Testing Odos API...\n');

  // Example 1: Get quote for exact input (1 ETH to DAI) - using Uniswap V4 and Balancer V3 (Weighted & Stable)
  console.log('Example 1: Exact input - 1 ETH to DAI (Uniswap V4 + Balancer V3 Weighted/Stable)');
  try {
    const ethToDaiQuote = await odosAPI.getQuoteExactInput({
      inputToken: '0x0000000000000000000000000000000000000000', // ETH
      outputToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      inputAmount: ethers.utils.parseEther('1').toString(),
      userAddr: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1', // Example address
      useUniswap: true,
      useBalancer: true
    });
    
    console.log('Quote result:');
    console.log('- Input: 1 ETH');
    console.log(`- Output: ${ethers.utils.formatEther(ethToDaiQuote.outputAmounts[0])} DAI`);
    console.log(`- Gas estimate: ${ethToDaiQuote.gasEstimate}`);
    console.log(`- Price impact: ${ethToDaiQuote.priceImpact}%`);
    console.log('- Swap paths:');
    ethToDaiQuote.swapPaths.forEach(path => {
      console.log(`  ${path.protocolLabel}: ${path.sourceToken.symbol} -> ${path.targetToken.symbol} (${path.percentage}%)`);
    });
    console.log('\n');
  } catch (error) {
    console.error('Error getting ETH to DAI quote:', error.message);
  }

  // Example 2: Get quote for exact output (want exactly 5000 USDC from ETH)
  console.log('Example 2: Exact output - Want 5000 USDC from ETH');
  try {
    const ethToUsdcQuote = await odosAPI.getQuoteExactOutput({
      inputToken: '0x0000000000000000000000000000000000000000', // ETH
      outputToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      outputAmount: ethers.utils.parseUnits('5000', 6).toString(), // USDC has 6 decimals
      userAddr: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1'
    });
    
    console.log('Quote result:');
    console.log(`- Input: ${ethers.utils.formatEther(ethToUsdcQuote.inputAmounts[0])} ETH`);
    console.log('- Output: 5000 USDC');
    console.log(`- Gas estimate: ${ethToUsdcQuote.gasEstimate}`);
    console.log(`- Price impact: ${ethToUsdcQuote.priceImpact}%`);
    console.log('- Swap paths:');
    ethToUsdcQuote.swapPaths.forEach(path => {
      console.log(`  ${path.protocolLabel}: ${path.sourceToken.symbol} -> ${path.targetToken.symbol} (${path.percentage}%)`);
    });
    console.log('\n');
  } catch (error) {
    console.error('Error getting ETH to USDC quote:', error.message);
  }

  // Example 3: Get optimal route with swap instructions
  console.log('Example 3: Get optimal route with swap instructions');
  try {
    const optimalRoute = await odosAPI.getOptimalRoute({
      inputToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      outputToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      amount: ethers.utils.parseUnits('1000', 6).toString(), // 1000 USDC
      isExactInput: true,
      userAddr: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
      useUniswap: true,
      useBalancer: true
    });
    
    console.log('Optimal route found:');
    console.log(`- Protocols used: ${optimalRoute.protocols.join(', ')}`);
    console.log(`- Estimated gas: ${optimalRoute.estimatedGas}`);
    console.log(`- Price impact: ${optimalRoute.priceImpact}%`);
    console.log('- Swap instructions for SDK calldata generation:');
    console.log(JSON.stringify(optimalRoute.swapCalldata, null, 2));
  } catch (error) {
    console.error('Error getting optimal route:', error.message);
  }

  // Example 4: Get quote using only Uniswap V4
  console.log('\nExample 4: Get quote using only Uniswap V4');
  try {
    const uniswapOnlyQuote = await odosAPI.getQuoteExactInput({
      inputToken: '0x0000000000000000000000000000000000000000', // ETH
      outputToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      inputAmount: ethers.utils.parseEther('0.5').toString(),
      userAddr: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
      useUniswap: true,
      useBalancer: false // Only use Uniswap V4
    });
    
    console.log('Uniswap V4 only quote:');
    console.log('- Input: 0.5 ETH');
    console.log(`- Output: ${ethers.utils.formatUnits(uniswapOnlyQuote.outputAmounts[0], 6)} USDC`);
    console.log('- Protocols:', uniswapOnlyQuote.swapPaths.map(p => p.protocolLabel).join(', '));
  } catch (error) {
    console.error('Error getting Uniswap-only quote:', error.message);
  }

  // Example 5: Get quote using only Balancer V3
  console.log('\nExample 5: Get quote using only Balancer V3');
  try {
    const balancerOnlyQuote = await odosAPI.getQuoteExactInput({
      inputToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      outputToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      inputAmount: ethers.utils.parseUnits('500', 6).toString(),
      userAddr: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
      useUniswap: false, // Only use Balancer V3
      useBalancer: true
    });
    
    console.log('Balancer V3 only quote:');
    console.log('- Input: 500 USDC');
    console.log(`- Output: ${ethers.utils.formatEther(balancerOnlyQuote.outputAmounts[0])} DAI`);
    console.log('- Protocols:', balancerOnlyQuote.swapPaths.map(p => p.protocolLabel).join(', '));
  } catch (error) {
    console.error('Error getting Balancer-only quote:', error.message);
  }
}

// Integration with Uniswap/Balancer SDKs
async function generateTransactionCalldata(odosSwapCalldata) {
  console.log('\nGenerating transaction calldata from Odos swap instructions...');
  
  // This function would use the swap instructions from Odos
  // to generate actual transaction calldata using Uniswap/Balancer SDKs
  
  const transactions = [];
  
  for (const swap of odosSwapCalldata) {
    if (swap.protocol.includes('uniswap')) {
      // Use Uniswap SDK to generate calldata
      console.log(`- Generate Uniswap calldata for ${swap.tokenIn} -> ${swap.tokenOut}`);
      // const uniswapCalldata = await generateUniswapCalldata(swap);
      // transactions.push(uniswapCalldata);
    } else if (swap.protocol === 'balancer') {
      // Use Balancer SDK to generate calldata
      console.log(`- Generate Balancer calldata for ${swap.tokenIn} -> ${swap.tokenOut}`);
      // const balancerCalldata = await generateBalancerCalldata(swap);
      // transactions.push(balancerCalldata);
    }
  }
  
  return transactions;
}

// Run the test
if (process.env.NODE_ENV !== 'production') {
  testOdosAPI().catch(console.error);
}

export { testOdosAPI, generateTransactionCalldata };