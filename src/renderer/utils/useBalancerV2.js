import { ethers } from 'ethers';
import axios from 'axios';

const BALANCER_VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
const BALANCER_SUBGRAPH = 'https://gateway.thegraph.com/api/d692082c59f956790647e889e75fa84d/subgraphs/id/4rixbLvpuBCwXTJSwyAzQgsLR8KprnyMfyCuXT8Fj5cd';

const VAULT_ABI = [
  'function getPoolTokens(bytes32 poolId) external view returns (address[] memory tokens, uint256[] memory balances, uint256 lastChangeBlock)',
  'function swap(tuple(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData) singleSwap, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, uint256 limit, uint256 deadline) external returns (uint256 amountOut)',
  'function queryBatchSwap(uint8 kind, tuple(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds) external returns (int256[] memory assetDeltas)'
];

const POOL_ABI = [
  'function getPoolId() external view returns (bytes32)',
  'function getSwapFeePercentage() external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function getActualSupply() external view returns (uint256)',
  'function getRate() external view returns (uint256)'
];

export async function useBalancerV2({ tokenInAddress, tokenOutAddress, amountIn, slippageTolerance = 0.5, provider }) {
  try {
    console.log('🔍 Discovering Balancer pools for tokens:', tokenInAddress, tokenOutAddress);
    
    const vault = new ethers.Contract(BALANCER_VAULT, VAULT_ABI, provider);
    
    const pools = await discoverPools(tokenInAddress, tokenOutAddress, provider);
    console.log(`Found ${pools.length} pools containing one or both tokens`);
    
    const paths = await findOptimalPaths(
      tokenInAddress,
      tokenOutAddress,
      amountIn,
      pools,
      vault,
      provider,
      3
    );
    
    if (paths.length === 0) {
      console.log('❌ No valid paths found');
      return null;
    }
    
    const bestPath = paths[0];
    console.log('✅ Best path found:', {
      hops: bestPath.hops.length,
      expectedOutput: ethers.utils.formatEther(bestPath.amountOut),
      pools: bestPath.hops.map(h => h.poolId.slice(0, 10) + '...')
    });
    
    const minAmountOut = calculateMinAmountOut(bestPath.amountOut, slippageTolerance);
    
    const swapData = buildSwapCalldata(bestPath, minAmountOut);
    
    return {
      amountOut: bestPath.amountOut.toString(),
      minAmountOut: minAmountOut.toString(),
      path: bestPath,
      swapData,
      priceImpact: bestPath.priceImpact || '0',
      fees: bestPath.totalFees || '0',
      poolIds: bestPath.hops.map(h => h.poolId)
    };
    
  } catch (error) {
    console.error('❌ Error in useBalancerV2:', error);
    return null;
  }
}

async function discoverPools(tokenA, tokenB, provider) {
  try {
    const query = `
      {
        pools(
          first: 100,
          orderBy: totalShares
          orderDirection: desc
        ) {
          id
          address
          swapFee
          totalShares
          tokens {
            address
            balance
            decimals
            symbol
          }
        }
      }
    `;
    
    const subgraphUrl = BALANCER_SUBGRAPH.replace('[api-key]', process.env.VITE_GRAPH_API_KEY || 'd692082c59f956790647e889e75fa84d');
    
    const response = await axios.post(subgraphUrl, { query });
    
    if (!response.data || !response.data.data) {
      console.log('Using fallback pool discovery method');
      return await discoverPoolsFallback(tokenA, tokenB, provider);
    }
    
    const allPools = response.data.data.pools;
    
    // Filter pools that contain either tokenA or tokenB
    const relevantPools = allPools.filter(pool => {
      const tokenAddresses = pool.tokens.map(t => t.address.toLowerCase());
      return tokenAddresses.includes(tokenA.toLowerCase()) || 
             tokenAddresses.includes(tokenB.toLowerCase());
    });
    
    // Transform pools to expected format
    const transformedPools = relevantPools.map(pool => ({
      ...pool,
      poolType: 'WeightedPool', // Default type since it's not in the schema
      tokensList: pool.tokens.map(t => t.address),
      swapEnabled: true
    }));
    
    const additionalPools = await discoverIntermediatePools(tokenA, tokenB, transformedPools, subgraphUrl);
    
    return [...transformedPools, ...additionalPools];
    
  } catch (error) {
    console.error('Subgraph query failed, using fallback:', error.message);
    console.error('Error details:', error.response?.data || error);
    return await discoverPoolsFallback(tokenA, tokenB, provider);
  }
}

async function discoverIntermediatePools(tokenA, tokenB, directPools, subgraphUrl) {
  const intermediateTokens = new Set();
  
  directPools.forEach(pool => {
    pool.tokensList.forEach(token => {
      if (token !== tokenA.toLowerCase() && token !== tokenB.toLowerCase()) {
        intermediateTokens.add(token);
      }
    });
  });
  
  const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase();
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase();
  const usdt = '0xdAC17F958D2ee523a2206206994597C13D831ec7'.toLowerCase();
  const wbtc = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'.toLowerCase();
  
  [weth, usdc, usdt, wbtc].forEach(token => intermediateTokens.add(token));
  
  const additionalPools = [];
  
  for (const intermediateToken of intermediateTokens) {
    try {
      const query = `
        {
          pools(
            first: 20,
            orderBy: totalShares
            orderDirection: desc
          ) {
            id
            address
            swapFee
            totalShares
            tokens {
              address
              balance
              decimals
              symbol
            }
          }
        }
      `;
      
      const response = await axios.post(subgraphUrl, { query });
      
      if (response.data && response.data.data) {
        // Filter pools containing the intermediate token
        const filteredPools = response.data.data.pools.filter(pool => {
          const tokenAddresses = pool.tokens.map(t => t.address.toLowerCase());
          return tokenAddresses.includes(intermediateToken);
        });
        
        // Transform pools to expected format
        const transformed = filteredPools.map(pool => ({
          ...pool,
          poolType: 'WeightedPool',
          tokensList: pool.tokens.map(t => t.address),
          swapEnabled: true
        }));
        
        additionalPools.push(...transformed);
      }
    } catch (error) {
      console.error(`Failed to fetch pools for intermediate token ${intermediateToken}`);
    }
  }
  
  return additionalPools;
}

async function discoverPoolsFallback(tokenA, tokenB, provider) {
  const knownPools = [
    {
      id: '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014',
      address: '0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56',
      poolType: 'WeightedPool',
      swapFee: '0.003',
      tokensList: [
        '0xba100000625a3754423978a60c9317c58a424e3D',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
      ],
      tokens: [
        {
          address: '0xba100000625a3754423978a60c9317c58a424e3D',
          balance: '1000000',
          weight: '0.8',
          decimals: 18
        },
        {
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          balance: '1000',
          weight: '0.2',
          decimals: 18
        }
      ],
      totalLiquidity: '10000000',
      swapEnabled: true
    }
  ];
  
  return knownPools.filter(pool => {
    const tokens = pool.tokensList.map(t => t.toLowerCase());
    return tokens.includes(tokenA.toLowerCase()) || tokens.includes(tokenB.toLowerCase());
  });
}

async function findOptimalPaths(tokenIn, tokenOut, amountIn, pools, vault, provider, maxHops = 3) {
  const paths = [];
  const visited = new Set();
  
  async function dfs(currentToken, targetToken, remainingAmount, currentPath, hopsLeft) {
    if (hopsLeft === 0) return;
    
    const pathKey = `${currentToken}-${currentPath.map(p => p.poolId).join(',')}`;
    if (visited.has(pathKey)) return;
    visited.add(pathKey);
    
    for (const pool of pools) {
      const tokens = pool.tokensList.map(t => t.toLowerCase());
      const currentTokenLower = currentToken.toLowerCase();
      
      if (!tokens.includes(currentTokenLower)) continue;
      
      for (const nextToken of tokens) {
        if (nextToken === currentTokenLower) continue;
        
        try {
          // For Balancer V3 subgraph, the ID is the pool address
          // We need to get the actual poolId from the pool contract
          let poolId = pool.id;
          
          // If the ID looks like an address (42 chars), we need to get the real pool ID
          if (poolId.length === 42) {
            try {
              // Try to get pool ID from the pool contract
              const poolContract = new ethers.Contract(poolId, ['function getPoolId() view returns (bytes32)'], provider);
              poolId = await poolContract.getPoolId();
            } catch (e) {
              // If that fails, try padding the address to make it a bytes32
              // This is for compatibility with some pool types
              poolId = poolId + '0'.repeat(66 - poolId.length);
            }
          }
          
          const poolTokens = await vault.getPoolTokens(poolId);
          const tokenInIndex = poolTokens[0].findIndex(
            t => t.toLowerCase() === currentTokenLower
          );
          const tokenOutIndex = poolTokens[0].findIndex(
            t => t.toLowerCase() === nextToken
          );
          
          if (tokenInIndex === -1 || tokenOutIndex === -1) continue;
          
          // Get weights from pool tokens if available
          let weightIn = null;
          let weightOut = null;
          if (pool.tokens && pool.tokens[tokenInIndex] && pool.tokens[tokenOutIndex]) {
            weightIn = pool.tokens[tokenInIndex].weight;
            weightOut = pool.tokens[tokenOutIndex].weight;
          }
          
          const outputAmount = calculateSwapOutput(
            remainingAmount,
            poolTokens[1][tokenInIndex],
            poolTokens[1][tokenOutIndex],
            pool.swapFee,
            pool.poolType,
            weightIn,
            weightOut
          );
          
          const hop = {
            poolId: pool.id,
            poolAddress: pool.address,
            tokenIn: currentToken,
            tokenOut: nextToken,
            amountIn: remainingAmount,
            amountOut: outputAmount,
            swapFee: pool.swapFee
          };
          
          const newPath = [...currentPath, hop];
          
          if (nextToken === targetToken.toLowerCase()) {
            const totalFees = newPath.reduce((sum, h) => 
              sum.add(ethers.BigNumber.from(h.amountIn).mul(Math.floor(parseFloat(h.swapFee) * 10000)).div(10000)), 
              ethers.BigNumber.from(0)
            );
            
            paths.push({
              hops: newPath,
              amountOut: outputAmount,
              totalFees: totalFees.toString(),
              priceImpact: calculatePriceImpact(amountIn, outputAmount, newPath)
            });
          } else if (hopsLeft > 1) {
            await dfs(nextToken, targetToken, outputAmount, newPath, hopsLeft - 1);
          }
        } catch (error) {
          console.error(`Error processing pool ${pool.id}:`, error);
        }
      }
    }
  }
  
  await dfs(tokenIn, tokenOut, ethers.BigNumber.from(amountIn), [], maxHops);
  
  paths.sort((a, b) => {
    const aOut = ethers.BigNumber.from(a.amountOut);
    const bOut = ethers.BigNumber.from(b.amountOut);
    return bOut.gt(aOut) ? 1 : -1;
  });
  
  return paths.slice(0, 5);
}

function calculateSwapOutput(amountIn, balanceIn, balanceOut, swapFee, poolType, weightIn = null, weightOut = null) {
  const fee = ethers.BigNumber.from(Math.floor(parseFloat(swapFee) * 1e18));
  const oneEther = ethers.utils.parseEther('1');
  const amountInAfterFee = amountIn.mul(oneEther.sub(fee)).div(oneEther);
  
  if (poolType === 'WeightedPool' || poolType === 'Weighted') {
    // Weighted pool formula: outAmount = balanceOut * (1 - (balanceIn / (balanceIn + inAmount))^(weightIn/weightOut))
    // For computational simplicity with BigNumbers, we use approximation:
    // outAmount ≈ balanceOut * (inAmount / balanceIn) * (weightOut / weightIn)
    
    if (!weightIn || !weightOut) {
      // Default to 50/50 if weights not provided
      weightIn = ethers.utils.parseEther('0.5');
      weightOut = ethers.utils.parseEther('0.5');
    } else {
      // Convert weights to BigNumber if they're strings
      weightIn = ethers.BigNumber.from(weightIn);
      weightOut = ethers.BigNumber.from(weightOut);
    }
    
    // Calculate the swap using weighted formula
    const weightRatio = weightOut.mul(oneEther).div(weightIn);
    const amountRatio = amountInAfterFee.mul(oneEther).div(balanceIn);
    const effectiveRatio = amountRatio.mul(weightRatio).div(oneEther);
    
    return balanceOut.mul(effectiveRatio).div(oneEther);
    
  } else if (poolType === 'StablePool' || poolType === 'Stable') {
    // Stable pool uses StableSwap invariant (simplified for 2 tokens)
    // This is a simplified calculation - real stable pools use more complex math
    const amp = ethers.BigNumber.from('100'); // Amplification parameter
    const sum = balanceIn.add(balanceOut);
    const product = balanceIn.mul(balanceOut);
    
    const newBalanceIn = balanceIn.add(amountInAfterFee);
    // Solve for newBalanceOut using stable swap invariant
    // Simplified: keep sum nearly constant with small product adjustment
    const newSum = sum.add(amountInAfterFee.mul(amp.sub(1)).div(amp));
    const newBalanceOut = newSum.sub(newBalanceIn);
    
    return balanceOut.gt(newBalanceOut) ? balanceOut.sub(newBalanceOut) : ethers.BigNumber.from(0);
    
  } else {
    // Constant product AMM (x * y = k)
    const product = balanceIn.mul(balanceOut);
    const newBalanceIn = balanceIn.add(amountInAfterFee);
    const newBalanceOut = product.div(newBalanceIn);
    return balanceOut.sub(newBalanceOut);
  }
}

function calculatePriceImpact(amountIn, amountOut, path) {
  const expectedPrice = amountOut.mul(ethers.utils.parseEther('1')).div(amountIn);
  
  let spotPrice = ethers.utils.parseEther('1');
  for (const hop of path) {
    const hopPrice = hop.amountOut.mul(ethers.utils.parseEther('1')).div(hop.amountIn);
    spotPrice = spotPrice.mul(hopPrice).div(ethers.utils.parseEther('1'));
  }
  
  if (spotPrice.isZero()) return '0';
  
  const impact = expectedPrice.sub(spotPrice).mul(10000).div(spotPrice);
  return impact.abs().toString();
}

function calculateMinAmountOut(amountOut, slippageTolerance) {
  const slippageFactor = Math.floor((100 - slippageTolerance) * 100);
  return amountOut.mul(slippageFactor).div(10000);
}

function buildSwapCalldata(path, minAmountOut) {
  const swaps = path.hops.map((hop, index) => ({
    poolId: hop.poolId,
    assetInIndex: index === 0 ? 0 : index,
    assetOutIndex: index === path.hops.length - 1 ? path.hops.length : index + 1,
    amount: hop.amountIn.toString(),
    userData: '0x'
  }));
  
  const assets = [path.hops[0].tokenIn];
  path.hops.forEach(hop => {
    if (!assets.includes(hop.tokenOut)) {
      assets.push(hop.tokenOut);
    }
  });
  
  const funds = {
    sender: '',
    fromInternalBalance: false,
    recipient: '',
    toInternalBalance: false
  };
  
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  
  const vaultInterface = new ethers.utils.Interface(VAULT_ABI);
  
  if (path.hops.length === 1) {
    const singleSwap = {
      poolId: swaps[0].poolId,
      assetInIndex: 0,
      assetOutIndex: 0,
      amount: swaps[0].amount,
      userData: swaps[0].userData
    };
    
    return vaultInterface.encodeFunctionData('swap', [
      singleSwap,
      funds,
      minAmountOut.toString(),
      deadline
    ]);
  } else {
    return vaultInterface.encodeFunctionData('queryBatchSwap', [
      0,
      swaps,
      assets,
      funds
    ]);
  }
}

export default useBalancerV2;