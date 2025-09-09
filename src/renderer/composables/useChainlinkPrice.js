import { ethers } from 'ethers';

class ChainlinkPriceOracle {
  constructor(provider) {
    this.provider = provider;
    
    this.REGISTRY_ADDRESS = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf';
    
    this.DENOMINATIONS = {
      USD: '0x0000000000000000000000000000000000000348',
    };
    
    this.REGISTRY_ABI = [
      'function latestRoundData(address base, address quote) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
      'function decimals(address base, address quote) external view returns (uint8)',
      'function getFeed(address base, address quote) external view returns (address)',
    ];
    
    this.DIRECT_FEEDS = {
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // WETH/USD
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', // WBTC/USD
      '0x514910771af9ca656af840dff83e8264ecf986ca': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c', // LINK/USD
      '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': '0x553303d460EE0afB37EdFf9bE42922D8FF63220e', // UNI/USD
      '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9', // AAVE/USD
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', // USDC/USD
      '0xdac17f958d2ee523a2206206994597c13d831ec7': '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D', // USDT/USD
      '0x6b175474e89094c44da98b954eedeac495271d0f': '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9', // DAI/USD
      '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': '0xCc70F09A6CC17553b2E31954cD36E4A2d89501f7', // SHIB/USD
      '0x3845badade8e6dff049820680d1f14bd3903a5d0': '0x3D7aE7E594f2f2091Ad8798313450130d0Aba3a0', // SAND/USD
      '0x4d224452801aced8b2f0aebe155379bb5d594381': '0xFd33ec6ABAa1Bdc3D9C6C85f1D6299e5a1a5511F', // APE/USD
      '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8', // stETH/USD
      '0x5a98fcbea516cf06857215779fd812ca3bef1b32': '0xDC530D9457755926550b59e8ECcdaE7624181557', // LDO/USD
    };
    
    this.registry = new ethers.Contract(
      this.REGISTRY_ADDRESS,
      this.REGISTRY_ABI,
      this.provider
    );
    
    this.decimalsCache = new Map();
  }
  
  async getPriceUSD(tokenAddress) {
    const normalizedAddress = tokenAddress.toLowerCase();
    
    try {
      const registryPrice = await this.getPriceFromRegistry(normalizedAddress);
      if (registryPrice && registryPrice.success) return registryPrice;
    } catch (error) {
      console.log(`Registry failed for ${normalizedAddress}: ${error.message}`);
    }
    
    try {
      const directPrice = await this.getPriceFromDirectFeed(normalizedAddress);
      if (directPrice && directPrice.success) return directPrice;
    } catch (error) {
      console.log(`Direct feed failed for ${normalizedAddress}: ${error.message}`);
    }
    
    return {
      success: false,
      price: 0,
      error: 'No Chainlink price feed available'
    };
  }
  
  async getPriceFromRegistry(baseAddress) {
    try {
      const feedAddress = await this.registry.getFeed(baseAddress, this.DENOMINATIONS.USD);
      if (feedAddress === ethers.constants.AddressZero) {
        return null;
      }
      
      const [roundData, decimals] = await Promise.all([
        this.registry.latestRoundData(baseAddress, this.DENOMINATIONS.USD),
        this.getDecimals(baseAddress, this.DENOMINATIONS.USD)
      ]);
      
      const { answer } = roundData;
      
      if (answer <= 0) {
        return null;
      }
      
      const price = this.formatPrice(answer, decimals);
      
      return {
        success: true,
        price: parseFloat(price),
        source: 'ChainlinkRegistry'
      };
    } catch (error) {
      return null;
    }
  }
  
  async getPriceFromDirectFeed(baseAddress) {
    const feedAddress = this.DIRECT_FEEDS[baseAddress];
    
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
      
      const { answer } = roundData;
      
      if (answer <= 0) {
        return null;
      }
      
      const price = this.formatPrice(answer, decimals);
      
      return {
        success: true,
        price: parseFloat(price),
        source: 'ChainlinkDirect'
      };
    } catch (error) {
      return null;
    }
  }
  
  async getDecimals(baseAddress, quoteAddress) {
    const key = `${baseAddress}-${quoteAddress}`;
    
    if (this.decimalsCache.has(key)) {
      return this.decimalsCache.get(key);
    }
    
    try {
      const decimals = await this.registry.decimals(baseAddress, quoteAddress);
      this.decimalsCache.set(key, decimals);
      return decimals;
    } catch {
      return 8;
    }
  }
  
  formatPrice(price, decimals) {
    const priceString = price.toString();
    const isNegative = priceString.startsWith('-');
    const absolutePrice = isNegative ? priceString.slice(1) : priceString;
    
    const paddedPrice = absolutePrice.padStart(decimals + 1, '0');
    
    const beforeDecimal = paddedPrice.slice(0, -decimals) || '0';
    const afterDecimal = paddedPrice.slice(-decimals);
    
    let formattedPrice = `${beforeDecimal}.${afterDecimal}`;
    formattedPrice = formattedPrice.replace(/\.?0+$/, '') || '0';
    
    return isNegative ? '-' + formattedPrice : formattedPrice;
  }
}

let oracleInstance = null;

export function useChainlinkPrice() {
  const initOracle = (provider) => {
    if (!oracleInstance) {
      oracleInstance = new ChainlinkPriceOracle(provider);
    }
    return oracleInstance;
  };
  
  const getPriceFromChainlink = async (tokenAddress, provider) => {
    const oracle = initOracle(provider);
    return await oracle.getPriceUSD(tokenAddress);
  };
  
  return {
    getPriceFromChainlink
  };
}