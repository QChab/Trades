import { ethers } from 'ethers';
import { useMixedUniswapBalancer } from './src/renderer/utils/useMixedUniswapBalancer.js';
import { calculateUniswapExactOutput, calculateBalancerExactOutput } from './src/renderer/utils/exactAMMOutputs.js';

async function testSpecificSplit() {
  const provider = new ethers.providers.JsonRpcProvider('https://eth.llamarpc.com');
  
  const ONE = {
    address: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212',
    symbol: 'ONE',
    decimals: 18
  };
  
  const ETH = {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    decimals: 18
  };
  
  const amountIn = ethers.utils.parseUnits('10', 18);
  
  // Test specific splits
  const testSplits = [0.4493, 0.4722, 0.45, 0.47, 0.48];
  
  for (const balancerFraction of testSplits) {
    const balancerAmount = amountIn.mul(Math.floor(balancerFraction * 1000000)).div(1000000);
    const uniswapAmount = amountIn.sub(balancerAmount);
    
    console.log(`\nTesting ${(balancerFraction * 100).toFixed(2)}% Balancer / ${((1-balancerFraction) * 100).toFixed(2)}% Uniswap:`);
    console.log(`  Balancer amount: ${ethers.utils.formatEther(balancerAmount)} ONE`);
    console.log(`  Uniswap amount: ${ethers.utils.formatEther(uniswapAmount)} ONE`);
    
    // We need to estimate outputs - let's use the linear approximation for now
    // Balancer output ~0.064089 ETH per ONE
    // Uniswap output ~0.0645522 ETH per ONE
    
    const balancerRate = 0.064089;
    const uniswapRate = 0.0645522;
    
    const balancerOutput = parseFloat(ethers.utils.formatEther(balancerAmount)) * balancerRate;
    const uniswapOutput = parseFloat(ethers.utils.formatEther(uniswapAmount)) * uniswapRate;
    const totalOutput = balancerOutput + uniswapOutput;
    
    console.log(`  Estimated Balancer output: ${balancerOutput.toFixed(6)} ETH`);
    console.log(`  Estimated Uniswap output: ${uniswapOutput.toFixed(6)} ETH`);
    console.log(`  Total output: ${totalOutput.toFixed(6)} ETH`);
  }
}

testSpecificSplit().catch(console.error);
