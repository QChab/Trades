import OdosAPI from './OdosAPI.js';
import { complexResponse } from './ComplexResponse.js';

function testComplexParsing() {
  const odosAPI = new OdosAPI();
  
  console.log('Testing complex Odos response parsing...\n');
  console.log('Input: 1000 ETH -> DAI');
  console.log('This is a complex multi-path swap with 42 different routes\n');
  
  // Parse the response
  const parsedResult = odosAPI.parseQuoteResponse(complexResponse);
  
  console.log('\n=== PARSING RESULTS ===\n');
  console.log(`Total paths extracted: ${parsedResult.swapPaths.length}`);
  console.log(`Gas estimate: ${parsedResult.gasEstimate}`);
  console.log(`Price impact: ${parsedResult.priceImpact}%`);
  console.log(`Net output value: $${parsedResult.netOutValue.toFixed(2)}`);
  
  // Group paths by depth to show execution order
  const pathsByDepth = {};
  parsedResult.swapPaths.forEach(path => {
    const depth = path.depth || 0;
    if (!pathsByDepth[depth]) {
      pathsByDepth[depth] = [];
    }
    pathsByDepth[depth].push(path);
  });
  
  console.log('\n=== EXECUTION ORDER BY DEPTH ===\n');
  Object.keys(pathsByDepth).sort((a, b) => a - b).forEach(depth => {
    console.log(`\nDepth ${depth} (${pathsByDepth[depth].length} swaps):`);
    console.log('─'.repeat(60));
    
    pathsByDepth[depth].forEach(path => {
      const percentage = path.percentage.toFixed(2);
      const inputAmount = path.inputValue.toFixed(4);
      const outputAmount = path.outputValue.toFixed(4);
      
      console.log(
        `  ${path.sourceToken.symbol.padEnd(6)} → ${path.targetToken.symbol.padEnd(6)} | ` +
        `${percentage.padStart(6)}% | ` +
        `In: ${inputAmount.padStart(12)} | Out: ${outputAmount.padStart(12)} | ` +
        `${path.protocolLabel}`
      );
    });
  });
  
  // Verify sequential ordering
  console.log('\n=== SEQUENTIAL VERIFICATION ===\n');
  
  // Check that all depth 0 swaps start from ETH
  const depth0Swaps = pathsByDepth[0] || [];
  const allDepth0FromETH = depth0Swaps.every(path => 
    path.sourceToken.symbol === 'ETH'
  );
  console.log(`✓ All depth 0 swaps start from ETH: ${allDepth0FromETH}`);
  
  // Check that depth 1 swaps use outputs from depth 0
  const depth0OutputTokens = new Set(depth0Swaps.map(p => p.targetToken.symbol));
  const depth1Swaps = pathsByDepth[1] || [];
  const allDepth1Valid = depth1Swaps.every(path => 
    depth0OutputTokens.has(path.sourceToken.symbol)
  );
  console.log(`✓ All depth 1 swaps use depth 0 outputs: ${allDepth1Valid}`);
  
  // Identify the protocols used
  const protocols = new Set(parsedResult.swapPaths.map(p => p.protocolLabel));
  console.log('\n=== PROTOCOLS USED ===\n');
  console.log(Array.from(protocols).sort().join(', '));
  
  // Summary of token flow
  console.log('\n=== TOKEN FLOW SUMMARY ===\n');
  const tokenFlows = {};
  parsedResult.swapPaths.forEach(path => {
    const key = `${path.sourceToken.symbol} → ${path.targetToken.symbol}`;
    if (!tokenFlows[key]) {
      tokenFlows[key] = { count: 0, totalPercentage: 0 };
    }
    tokenFlows[key].count++;
    tokenFlows[key].totalPercentage += path.percentage;
  });
  
  Object.entries(tokenFlows)
    .sort((a, b) => b[1].totalPercentage - a[1].totalPercentage)
    .slice(0, 10)
    .forEach(([flow, data]) => {
      console.log(`  ${flow.padEnd(20)} | ${data.count} routes | ${data.totalPercentage.toFixed(2)}%`);
    });
  
  console.log('\n=== CALLDATA GENERATION ===\n');
  const swapCalldata = odosAPI.generateSwapCalldata(parsedResult.swapPaths);
  console.log(`Generated ${swapCalldata.length} swap instructions`);
  
  // Show SDK type distribution
  const sdkTypes = {};
  swapCalldata.forEach(instruction => {
    sdkTypes[instruction.sdkType] = (sdkTypes[instruction.sdkType] || 0) + 1;
  });
  
  console.log('\nSDK distribution:');
  Object.entries(sdkTypes).forEach(([sdk, count]) => {
    console.log(`  ${sdk}: ${count} swaps`);
  });
  
  return parsedResult;
}

// Run the test
const result = testComplexParsing();

export { testComplexParsing, complexResponse };