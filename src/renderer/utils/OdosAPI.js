class OdosAPI {
  constructor() {
    this.baseURL = 'https://api.odos.xyz';
    this.chainId = 1; // Ethereum mainnet
  }

  async getQuote({
    inputTokens,
    outputTokens,
    inputAmounts = [],
    outputAmounts = [],
    userAddr = '0x0000000000000000000000000000000000000000',
    slippageLimitPercent = 0.3,
    referralCode = 0,
    disableRFQs = true,
    compact = true,
    useUniswap = true,
    useBalancer = true
  }) {
    try {
      // Build list of allowed liquidity sources based on flags
      const liquiditySourcesWhitelist = [];
      
      if (useUniswap) {
        // Add Uniswap V4
        liquiditySourcesWhitelist.push('Uniswap V4');
      }
      
      if (useBalancer) {
        // Add Balancer V3 pools (Weighted and Stable)
        liquiditySourcesWhitelist.push('Balancer V3 Weighted');
        liquiditySourcesWhitelist.push('Balancer V3 Stable');
      }

      if (liquiditySourcesWhitelist.length === 0) {
        throw new Error('At least one exchange must be enabled (useUniswap or useBalancer)');
      }

      const requestBody = {
        chainId: this.chainId,
        inputTokens,
        outputTokens,
        inputAmounts: inputAmounts.map(amount => String(amount)),
        outputAmounts: outputAmounts.map(amount => String(amount)),
        userAddr,
        slippageLimitPercent,
        referralCode,
        disableRFQs,
        compact,
        liquiditySourcesWhitelist // Only use specified liquidity sources
      };

      console.log('Odos quote request:', requestBody);

      const response = await fetch(
        `${this.baseURL}/sor/quote/v3`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Odos API error: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();
      return this.parseQuoteResponse(data);
    } catch (error) {
      console.error('Odos quote error:', error.message);
      throw error;
    }
  }

  parseQuoteResponse(data) {
    const swapPaths = this.extractSwapPaths(data.pathViz);
    
    return {
      inputTokens: data.inTokens,
      outputTokens: data.outTokens,
      inputAmounts: data.inAmounts,
      outputAmounts: data.outAmounts,
      gasEstimate: data.gasEstimate,
      gasEstimateValue: data.gasEstimateValue,
      priceImpact: data.priceImpact,
      percentDiff: data.percentDiff,
      netOutValue: data.netOutValue,
      swapPaths,
      pathViz: data.pathViz,
      blockNumber: data.blockNumber
    };
  }

  extractSwapPaths(pathViz) {
    if (!pathViz || !pathViz.links) return [];

    const paths = [];
    const nodeMap = {};

    // Build node map with token information
    pathViz.nodes.forEach((node, index) => {
      nodeMap[index] = {
        name: node.name,
        symbol: node.symbol,
        decimals: node.decimals,
        address: this.getTokenAddress(node.symbol),
        visible: node.visible
      };
    });

    // Group links by their execution order based on token dependencies
    const linksByDepth = [];
    const processedTargets = new Set([0]); // Start with source token (node 0)
    const remainingLinks = [...pathViz.links];
    
    // Process links in waves based on dependencies
    while (remainingLinks.length > 0) {
      const currentDepthLinks = [];
      const newTargets = new Set();
      
      // Find all links that can be executed at this depth
      for (let i = remainingLinks.length - 1; i >= 0; i--) {
        const link = remainingLinks[i];
        
        // Check if source token is available (has been processed or is the initial token)
        if (processedTargets.has(link.source)) {
          currentDepthLinks.push(link);
          newTargets.add(link.target);
          remainingLinks.splice(i, 1);
        }
      }
      
      if (currentDepthLinks.length === 0 && remainingLinks.length > 0) {
        // Handle disconnected paths (shouldn't happen in valid routes)
        console.warn('Found disconnected paths, adding remaining links');
        currentDepthLinks.push(...remainingLinks);
        remainingLinks.length = 0;
      }
      
      // Sort links within the same depth for consistent ordering
      currentDepthLinks.sort((a, b) => {
        // First by source node, then by target node
        if (a.source !== b.source) return a.source - b.source;
        return a.target - b.target;
      });
      
      linksByDepth.push(currentDepthLinks);
      newTargets.forEach(target => processedTargets.add(target));
    }
    
    // Flatten the depth-ordered links into sequential paths
    linksByDepth.forEach((depthLinks, depth) => {
      depthLinks.forEach(link => {
        const sourceToken = nodeMap[link.source];
        const targetToken = nodeMap[link.target];
        const protocol = this.parseProtocol(link.label);
        
        // Handle special case for wrapped tokens (like ETH -> WETH)
        const isWrapping = link.label === 'Wrapped Ether' || 
                          (link.sourceToken?.symbol === 'ETH' && link.targetToken?.symbol === 'WETH');
        
        paths.push({
          protocol: isWrapping ? 'wrap' : protocol,
          protocolLabel: link.label,
          sourceToken: {
            ...sourceToken,
            ...link.sourceToken
          },
          targetToken: {
            ...targetToken,
            ...link.targetToken
          },
          percentage: link.value,
          inputValue: link.in_value,
          outputValue: link.out_value,
          hopIndex: paths.length,
          depth: depth,
          sourceNodeIndex: link.source,
          targetNodeIndex: link.target,
          isWrapping
        });
      });
    });

    // Log the execution order for verification
    console.log('Swap execution order by depth:');
    linksByDepth.forEach((depthLinks, depth) => {
      const swaps = depthLinks.map(link => 
        `${nodeMap[link.source].symbol}->${nodeMap[link.target].symbol}(${link.value.toFixed(2)}%)`
      );
      console.log(`  Depth ${depth}: ${swaps.join(', ')}`);
    });
    
    console.log('Total paths extracted:', paths.length);

    return paths;
  }

  parseProtocol(label) {
    const labelLower = label.toLowerCase();
    
    // Uniswap versions
    if (labelLower.includes('uniswap v4')) return 'uniswapV4';
    if (labelLower.includes('uniswap v3')) return 'uniswapV3';
    if (labelLower.includes('uniswap v2')) return 'uniswapV2';
    
    // Balancer V3 pool types
    if (labelLower.includes('balancer v3 weighted')) return 'balancerV3Weighted';
    if (labelLower.includes('balancer v3 stable')) return 'balancerV3Stable';
    if (labelLower.includes('balancer v3 gyro')) return 'balancerV3Gyro';
    if (labelLower.includes('balancer v3 reclamm')) return 'balancerV3ReCLAMM';
    if (labelLower.includes('balancer v3 stablesurge')) return 'balancerV3StableSurge';
    if (labelLower.includes('balancer v3')) return 'balancerV3';
    if (labelLower.includes('balancer')) return 'balancer';
    
    // Other protocols
    if (labelLower.includes('curve')) return 'curve';
    if (labelLower.includes('sushiswap')) return 'sushiswap';
    
    return 'unknown';
  }

  getTokenAddress(symbol) {
    const tokenAddresses = {
      'ETH': '0x0000000000000000000000000000000000000000',
      'WETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    };
    
    return tokenAddresses[symbol] || null;
  }

  async getQuoteExactInput({
    inputToken,
    outputToken,
    inputAmount,
    userAddr,
    useUniswap = true,
    useBalancer = true
  }) {
    return this.getQuote({
      inputTokens: [inputToken],
      outputTokens: [outputToken],
      inputAmounts: [inputAmount],
      outputAmounts: [],
      userAddr,
      useUniswap,
      useBalancer
    });
  }

  async getQuoteExactOutput({
    inputToken,
    outputToken,
    outputAmount,
    userAddr,
    useUniswap = true,
    useBalancer = true
  }) {
    return this.getQuote({
      inputTokens: [inputToken],
      outputTokens: [outputToken],
      inputAmounts: [],
      outputAmounts: [outputAmount],
      userAddr,
      useUniswap,
      useBalancer
    });
  }

  generateSwapCalldata(swapPaths) {
    const swapInstructions = swapPaths.map(path => {
      // Determine if this is Balancer or Uniswap for SDK selection
      const isBalancer = path.protocol.startsWith('balancerV3');
      const isUniswap = path.protocol.startsWith('uniswapV');
      
      return {
        protocol: path.protocol,
        protocolLabel: path.protocolLabel,
        sdkType: isBalancer ? 'balancer' : (isUniswap ? 'uniswap' : 'unknown'),
        tokenIn: path.sourceToken.address || path.sourceToken.symbol,
        tokenOut: path.targetToken.address || path.targetToken.symbol,
        amountIn: path.inputValue,
        amountOut: path.outputValue,
        percentage: path.percentage,
        hopIndex: path.hopIndex
      };
    });

    return swapInstructions;
  }

  async getOptimalRoute({
    inputToken,
    outputToken,
    amount,
    isExactInput = true,
    userAddr = '0x0000000000000000000000000000000000000000',
    useUniswap = true,
    useBalancer = true
  }) {
    try {
      let quote;
      
      if (isExactInput) {
        quote = await this.getQuoteExactInput({
          inputToken,
          outputToken,
          inputAmount: amount,
          userAddr,
          useUniswap,
          useBalancer
        });
      } else {
        quote = await this.getQuoteExactOutput({
          inputToken,
          outputToken,
          outputAmount: amount,
          userAddr,
          useUniswap,
          useBalancer
        });
      }

      const swapCalldata = this.generateSwapCalldata(quote.swapPaths);

      return {
        quote,
        swapCalldata,
        protocols: [...new Set(quote.swapPaths.map(p => p.protocol))],
        estimatedGas: quote.gasEstimate,
        priceImpact: quote.priceImpact
      };
    } catch (error) {
      console.error('Failed to get optimal route:', error);
      throw error;
    }
  }
}

export default OdosAPI;