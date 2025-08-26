const { ethers } = require('ethers');

class ChainlinkFeedRegistry {
    constructor(provider) {
        this.provider = provider;
        
        // Feed Registry address (Ethereum Mainnet only)
        this.REGISTRY_ADDRESS = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf';
        
        // Denomination addresses
        this.DENOMINATIONS = {
            ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            BTC: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
            USD: '0x0000000000000000000000000000000000000348', // address(840)
            EUR: '0x00000000000000000000000000000000000003D2', // address(978)
            GBP: '0x000000000000000000000000000000000000033A', // address(826)
            JPY: '0x0000000000000000000000000000000000000188', // address(392)
        };
        
        // Feed Registry ABI
        this.REGISTRY_ABI = [
            'function latestRoundData(address base, address quote) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
            'function getRoundData(address base, address quote, uint80 _roundId) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
            'function decimals(address base, address quote) external view returns (uint8)',
            'function description(address base, address quote) external view returns (string)',
            'function getFeed(address base, address quote) external view returns (address)',
            'function isFeedEnabled(address aggregator) external view returns (bool)',
            'function version(address base, address quote) external view returns (uint256)',
            'function getCurrentPhaseId(address base, address quote) external view returns (uint16)',
            'function latestAnswer(address base, address quote) external view returns (int256)',
            'function latestTimestamp(address base, address quote) external view returns (uint256)',
            'function latestRound(address base, address quote) external view returns (uint256)'
        ];
        
        // Direct feed addresses for common pairs (fallback if registry fails)
        this.DIRECT_FEEDS = {
            // ETH pairs
            '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2-USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // WETH/USD
            '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599-USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', // WBTC/USD
            '0x514910771AF9Ca656af840dff83E8264EcF986CA-USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c', // LINK/USD
            '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984-USD': '0x553303d460EE0afB37EdFf9bE42922D8FF63220e', // UNI/USD
            '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9-USD': '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9', // AAVE/USD
            '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48-USD': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', // USDC/USD
            '0xdAC17F958D2ee523a2206206994597C13D831ec7-USD': '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D', // USDT/USD
            '0x6B175474E89094C44Da98b954EedeAC495271d0F-USD': '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9', // DAI/USD
        };
        
        // Initialize registry contract
        this.registry = new ethers.Contract(
            this.REGISTRY_ADDRESS,
            this.REGISTRY_ABI,
            this.provider
        );
        
        // Cache for feed addresses and decimals
        this.feedCache = new Map();
        this.decimalsCache = new Map();
    }
    
    /**
     * Get token price in USD
     * @param {string} tokenAddress - Token contract address
     * @returns {Promise<object>} Price data with metadata
     */
    async getPriceUSD(tokenAddress) {
        return this.getPrice(tokenAddress, this.DENOMINATIONS.USD);
    }
    
    /**
     * Get token price in ETH
     * @param {string} tokenAddress - Token contract address
     * @returns {Promise<object>} Price data with metadata
     */
    async getPriceETH(tokenAddress) {
        return this.getPrice(tokenAddress, this.DENOMINATIONS.ETH);
    }
    
    /**
     * Get token price in any supported denomination
     * @param {string} baseAddress - Base token address
     * @param {string} quoteAddress - Quote token address (or use DENOMINATIONS)
     * @returns {Promise<object>} Price data with metadata
     */
    async getPrice(baseAddress, quoteAddress) {
        const cacheKey = `${baseAddress}-${quoteAddress}`;
        
        try {
            // Try Feed Registry first
            const registryPrice = await this.getPriceFromRegistry(baseAddress, quoteAddress);
            if (registryPrice) return registryPrice;
        } catch (error) {
            console.log(`Registry failed for ${cacheKey}: ${error.message}`);
        }
        
        // Try direct feed as fallback
        try {
            const directPrice = await this.getPriceFromDirectFeed(baseAddress, quoteAddress);
            if (directPrice) return directPrice;
        } catch (error) {
            console.log(`Direct feed failed for ${cacheKey}: ${error.message}`);
        }
        
        // If both fail, return null with explanation
        return {
            success: false,
            error: 'No Chainlink price feed available for this token pair',
            tokenAddress: baseAddress,
            denomination: this.getDenominationName(quoteAddress),
            suggestion: 'This token is not supported by Chainlink. Consider using DEX-based oracles for low liquidity tokens.'
        };
    }
    
    /**
     * Get price from Feed Registry
     */
    async getPriceFromRegistry(baseAddress, quoteAddress) {
        try {
            // Check if feed exists
            const feedAddress = await this.registry.getFeed(baseAddress, quoteAddress);
            if (feedAddress === ethers.ZeroAddress) {
                return null;
            }
            
            // Get latest round data
            const [roundData, decimals] = await Promise.all([
                this.registry.latestRoundData(baseAddress, quoteAddress),
                this.getDecimals(baseAddress, quoteAddress)
            ]);
            
            const { roundId, answer, startedAt, updatedAt, answeredInRound } = roundData;
            
            // Validate data
            if (answer <= 0) {
                throw new Error('Invalid price: negative or zero');
            }
            
            const currentTime = Math.floor(Date.now() / 1000);
            const age = currentTime - Number(updatedAt);
            
            if (age > 3600) { // More than 1 hour old
                console.warn(`Price data is ${age} seconds old (stale)`);
            }
            
            // Format price
            const price = this.formatPrice(answer, decimals);
            
            return {
                success: true,
                price: price,
                priceRaw: answer.toString(),
                decimals: decimals,
                timestamp: Number(updatedAt),
                age: age,
                roundId: roundId.toString(),
                source: 'ChainlinkFeedRegistry',
                feedAddress: feedAddress,
                tokenAddress: baseAddress,
                denomination: this.getDenominationName(quoteAddress),
                isStale: age > 3600
            };
            
        } catch (error) {
            // Feed doesn't exist or other error
            return null;
        }
    }
    
    /**
     * Get price from direct feed mapping
     */
    async getPriceFromDirectFeed(baseAddress, quoteAddress) {
        const quoteName = this.getDenominationName(quoteAddress);
        const feedKey = `${baseAddress}-${quoteName}`;
        const feedAddress = this.DIRECT_FEEDS[feedKey];
        
        if (!feedAddress) {
            return null;
        }
        
        const aggregatorABI = [
            'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
            'function decimals() external view returns (uint8)'
        ];
        
        const aggregator = new ethers.Contract(feedAddress, aggregatorABI, this.provider);
        
        try {
            const [roundData, decimals] = await Promise.all([
                aggregator.latestRoundData(),
                aggregator.decimals()
            ]);
            
            const { roundId, answer, startedAt, updatedAt, answeredInRound } = roundData;
            
            if (answer <= 0) {
                throw new Error('Invalid price: negative or zero');
            }
            
            const currentTime = Math.floor(Date.now() / 1000);
            const age = currentTime - Number(updatedAt);
            
            const price = this.formatPrice(answer, decimals);
            
            return {
                success: true,
                price: price,
                priceRaw: answer.toString(),
                decimals: decimals,
                timestamp: Number(updatedAt),
                age: age,
                roundId: roundId.toString(),
                source: 'ChainlinkDirectFeed',
                feedAddress: feedAddress,
                tokenAddress: baseAddress,
                denomination: quoteName,
                isStale: age > 3600
            };
            
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Get multiple prices in batch
     * @param {Array<{token: string, quote?: string}>} pairs - Array of token pairs to query
     * @returns {Promise<Array>} Array of price results
     */
    async getBatchPrices(pairs) {
        const promises = pairs.map(pair => {
            const quote = pair.quote || this.DENOMINATIONS.USD;
            return this.getPrice(pair.token, quote);
        });
        
        return Promise.all(promises);
    }
    
    /**
     * Convert price between denominations
     * @param {string} amount - Amount to convert
     * @param {string} fromToken - Source token address
     * @param {string} toToken - Target token address
     * @returns {Promise<object>} Conversion result
     */
    async convert(amount, fromToken, toToken) {
        try {
            // Get both prices in USD
            const [fromPrice, toPrice] = await Promise.all([
                this.getPriceUSD(fromToken),
                this.getPriceUSD(toToken)
            ]);
            
            if (!fromPrice.success || !toPrice.success) {
                throw new Error('Failed to get prices for conversion');
            }
            
            const amountBN = ethers.parseEther(amount.toString());
            const fromPriceBN = ethers.parseEther(fromPrice.price.toString());
            const toPriceBN = ethers.parseEther(toPrice.price.toString());
            
            // Calculate: amount * fromPrice / toPrice
            const resultBN = (amountBN * fromPriceBN) / toPriceBN;
            const result = ethers.formatEther(resultBN);
            
            return {
                success: true,
                input: {
                    amount: amount,
                    token: fromToken,
                    price: fromPrice.price
                },
                output: {
                    amount: result,
                    token: toToken,
                    price: toPrice.price
                },
                rate: fromPrice.price / toPrice.price,
                timestamp: Math.min(fromPrice.timestamp, toPrice.timestamp)
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Check if a price feed exists for a token pair
     * @param {string} baseAddress - Base token address
     * @param {string} quoteAddress - Quote token address
     * @returns {Promise<boolean>} True if feed exists
     */
    async feedExists(baseAddress, quoteAddress) {
        try {
            const feedAddress = await this.registry.getFeed(baseAddress, quoteAddress);
            return feedAddress !== ethers.ZeroAddress;
        } catch {
            return false;
        }
    }
    
    /**
     * Get all available feeds for a token
     * @param {string} tokenAddress - Token to check
     * @returns {Promise<object>} Available feeds for the token
     */
    async getAvailableFeeds(tokenAddress) {
        const denominations = ['USD', 'ETH', 'BTC'];
        const results = {};
        
        for (const denom of denominations) {
            const exists = await this.feedExists(tokenAddress, this.DENOMINATIONS[denom]);
            if (exists) {
                results[denom] = await this.registry.getFeed(tokenAddress, this.DENOMINATIONS[denom]);
            }
        }
        
        return results;
    }
    
    /**
     * Get historical price data
     * @param {string} baseAddress - Base token address
     * @param {string} quoteAddress - Quote token address
     * @param {number} roundId - Specific round ID to query
     * @returns {Promise<object>} Historical price data
     */
    async getHistoricalPrice(baseAddress, quoteAddress, roundId) {
        try {
            const [roundData, decimals] = await Promise.all([
                this.registry.getRoundData(baseAddress, quoteAddress, roundId),
                this.getDecimals(baseAddress, quoteAddress)
            ]);
            
            const { answer, updatedAt } = roundData;
            const price = this.formatPrice(answer, decimals);
            
            return {
                success: true,
                price: price,
                timestamp: Number(updatedAt),
                roundId: roundId
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Helper: Get decimals with caching
     */
    async getDecimals(baseAddress, quoteAddress) {
        const key = `${baseAddress}-${quoteAddress}`;
        
        if (this.decimalsCache.has(key)) {
            return this.decimalsCache.get(key);
        }
        
        const decimals = await this.registry.decimals(baseAddress, quoteAddress);
        this.decimalsCache.set(key, decimals);
        
        return decimals;
    }
    
    /**
     * Helper: Format price based on decimals
     */
    formatPrice(price, decimals) {
        // Convert BigNumber price to string with proper decimals
        const priceString = price.toString();
        const isNegative = priceString.startsWith('-');
        const absolutePrice = isNegative ? priceString.slice(1) : priceString;
        
        // Pad with zeros if necessary
        const paddedPrice = absolutePrice.padStart(decimals + 1, '0');
        
        // Insert decimal point
        const beforeDecimal = paddedPrice.slice(0, -decimals) || '0';
        const afterDecimal = paddedPrice.slice(-decimals);
        
        // Format and remove trailing zeros
        let formattedPrice = `${beforeDecimal}.${afterDecimal}`;
        formattedPrice = formattedPrice.replace(/\.?0+$/, '');
        
        return isNegative ? '-' + formattedPrice : formattedPrice;
    }
    
    /**
     * Helper: Get denomination name from address
     */
    getDenominationName(address) {
        for (const [name, addr] of Object.entries(this.DENOMINATIONS)) {
            if (addr.toLowerCase() === address.toLowerCase()) {
                return name;
            }
        }
        return 'UNKNOWN';
    }
}

// Usage Example
async function example() {
    // Initialize with your provider
    const provider = new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY');
    const priceOracle = new ChainlinkFeedRegistry(provider);
    
    // Example token addresses
    const tokens = {
        WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
        UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
        AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        // Low liquidity token (will fail)
        RANDOM: '0x1234567890123456789012345678901234567890'
    };
    
    console.log('=== Chainlink Feed Registry Price Checker ===\n');
    
    // 1. Get single token price in USD
    console.log('1. LINK/USD Price:');
    const linkPrice = await priceOracle.getPriceUSD(tokens.LINK);
    console.log(linkPrice);
    
    // 2. Get token price in ETH
    console.log('\n2. UNI/ETH Price:');
    const uniPriceETH = await priceOracle.getPriceETH(tokens.UNI);
    console.log(uniPriceETH);
    
    // 3. Batch price queries
    console.log('\n3. Batch Prices:');
    const batchPrices = await priceOracle.getBatchPrices([
        { token: tokens.WETH },
        { token: tokens.LINK },
        { token: tokens.AAVE }
    ]);
    batchPrices.forEach(price => {
        if (price.success) {
            console.log(`${price.tokenAddress}: $${price.price}`);
        }
    });
    
    // 4. Convert between tokens
    console.log('\n4. Convert 10 LINK to USDC:');
    const conversion = await priceOracle.convert('10', tokens.LINK, tokens.USDC);
    if (conversion.success) {
        console.log(`10 LINK = ${conversion.output.amount} USDC`);
        console.log(`Rate: 1 LINK = ${conversion.rate} USDC`);
    }
    
    // 5. Check available feeds for a token
    console.log('\n5. Available feeds for AAVE:');
    const aaveFeeds = await priceOracle.getAvailableFeeds(tokens.AAVE);
    console.log(aaveFeeds);
    
    // 6. Try low liquidity token (will fail gracefully)
    console.log('\n6. Low liquidity token (will fail):');
    const randomPrice = await priceOracle.getPriceUSD(tokens.RANDOM);
    console.log(randomPrice);
}

// Export for use in other modules
module.exports = ChainlinkFeedRegistry;