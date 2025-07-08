import { ethers } from 'ethers';
import WalletBundlerABI from '../../contracts/WalletBundler.json';
import WalletBundlerFactoryABI from '../../contracts/WalletBundlerFactory.json';

const FACTORY_ADDRESS = '0x...'; // To be deployed
const UNIVERSAL_ROUTER_ADDRESS = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD';
const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

export class BundlerManager {
  constructor(provider, signer) {
    this.provider = provider;
    this.signer = signer;
    this.factory = new ethers.Contract(FACTORY_ADDRESS, WalletBundlerFactoryABI, signer);
  }

  /**
   * Deploy a bundler contract for the current wallet
   */
  async deployBundler(salt = 0) {
    const tx = await this.factory.deployBundler(salt);
    const receipt = await tx.wait();
    
    // Get deployed address from events
    const event = receipt.events.find(e => e.event === 'BundlerDeployed');
    const bundlerAddress = event.args.bundler;
    
    return new ethers.Contract(bundlerAddress, WalletBundlerABI, this.signer);
  }

  /**
   * Get existing bundler for wallet
   */
  async getBundler(walletAddress) {
    const bundlers = await this.factory.getBundlersByOwner(walletAddress);
    if (bundlers.length === 0) return null;
    
    // Return the first bundler (most recent)
    return new ethers.Contract(bundlers[0], WalletBundlerABI, this.signer);
  }

  /**
   * Check and approve tokens for DEX routers
   */
  async setupApprovals(bundler, tokens) {
    const approvals = [];
    
    for (const token of tokens) {
      // Check Uniswap allowance
      const uniswapAllowance = await bundler.getAllowance(token.address, UNIVERSAL_ROUTER_ADDRESS);
      if (uniswapAllowance.lt(ethers.constants.MaxUint256.div(2))) {
        approvals.push({
          token: token.address,
          spender: UNIVERSAL_ROUTER_ADDRESS,
          amount: ethers.constants.MaxUint256
        });
      }
      
      // Check Balancer allowance
      const balancerAllowance = await bundler.getAllowance(token.address, BALANCER_VAULT_ADDRESS);
      if (balancerAllowance.lt(ethers.constants.MaxUint256.div(2))) {
        approvals.push({
          token: token.address,
          spender: BALANCER_VAULT_ADDRESS,
          amount: ethers.constants.MaxUint256
        });
      }
    }
    
    if (approvals.length > 0) {
      const tx = await bundler.batchApprove(
        approvals.map(a => a.token),
        approvals.map(a => a.spender),
        approvals.map(a => a.amount)
      );
      await tx.wait();
    }
  }

  /**
   * Execute bundled trades
   */
  async executeBundledTrades(bundler, trades) {
    // Prepare trade data
    const targets = [];
    const data = [];
    const values = [];
    const tokens = new Set();
    const expectSuccess = [];
    
    for (const trade of trades) {
      if (trade.protocol === 'Uniswap') {
        targets.push(UNIVERSAL_ROUTER_ADDRESS);
        data.push(trade.callData);
        values.push(trade.value || 0);
        expectSuccess.push(true); // Critical trades must succeed
      } else if (trade.protocol === 'Balancer') {
        targets.push(BALANCER_VAULT_ADDRESS);
        data.push(trade.callData);
        values.push(trade.value || 0);
        expectSuccess.push(true);
      }
      
      // Track tokens involved
      tokens.add(trade.fromToken.address);
      tokens.add(trade.toToken.address);
    }
    
    // Calculate total ETH needed
    const totalETH = values.reduce((sum, val) => sum.add(val), ethers.BigNumber.from(0));
    
    // Execute bundle
    const tx = await bundler.executeBundleWithTransfers(
      targets,
      data,
      values,
      Array.from(tokens),
      expectSuccess,
      { value: totalETH }
    );
    
    const receipt = await tx.wait();
    
    // Parse events for results
    const results = receipt.events
      .filter(e => e.event === 'TradeExecuted')
      .map(e => ({
        target: e.args.target,
        success: e.args.success,
        returnData: e.args.returnData
      }));
    
    return results;
  }

  /**
   * Transfer tokens to bundler for trading
   */
  async transferToBundler(bundler, token, amount) {
    const tokenContract = new ethers.Contract(
      token.address,
      ['function transfer(address,uint256) returns (bool)'],
      this.signer
    );
    
    const tx = await tokenContract.transfer(bundler.address, amount);
    await tx.wait();
  }

  /**
   * Check bundler balances
   */
  async getBundlerBalances(bundler, tokens) {
    const addresses = tokens.map(t => t.address);
    const balances = await bundler.getBalances(addresses);
    
    return tokens.map((token, i) => ({
      token,
      balance: balances[i],
      formatted: ethers.utils.formatUnits(balances[i], token.decimals)
    }));
  }

  /**
   * Emergency withdrawal
   */
  async emergencyWithdraw(bundler, token, amount = 0) {
    const tx = await bundler.emergencyWithdraw(token.address || ethers.constants.AddressZero, amount);
    await tx.wait();
  }
}