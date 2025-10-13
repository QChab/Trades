import { ethers } from 'ethers';
import WalletBundlerABI from '../../artifacts/contracts/WalletBundler.sol/WalletBundler.json' with { type: "json" };
import BundlerRegistryABI from '../../artifacts/contracts/BundlerRegistry.sol/BundlerRegistry.json' with { type: "json" };

const REGISTRY_ADDRESS = '0x4df4B688d6F7954F6F53787B2e2778720BaB5d28'; // To be deployed
const UNIVERSAL_ROUTER_ADDRESS = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD';
const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

export class BundlerManager {
  constructor(provider, signer, registryAddress = REGISTRY_ADDRESS) {
    this.provider = provider;
    this.signer = signer;
    this.registry = new ethers.Contract(registryAddress, BundlerRegistryABI.abi, signer);
  }

  /**
   * Deploy a bundler contract for the current wallet
   * Note: The bundler automatically registers itself in the constructor if no existing bundler
   */
  async deployBundler() {
    // Check if wallet already has a bundler registered
    const walletAddress = await this.signer.getAddress();
    const existingBundler = await this.getBundlerAddress(walletAddress);

    // Deploy WalletBundler directly
    const WalletBundlerFactory = new ethers.ContractFactory(
      WalletBundlerABI.abi,
      WalletBundlerABI.bytecode,
      this.signer
    );

    const bundler = await WalletBundlerFactory.deploy();
    await bundler.deployed();

    // If wallet already had a bundler, manually register the new one using storeAddress
    if (existingBundler && existingBundler !== ethers.constants.AddressZero) {
      const tx = await this.registry.storeAddress(bundler.address);
      await tx.wait();
    }
    // Otherwise, the constructor's registerBundler() call already handled registration

    return { success: true, address: bundler.address, contract: bundler };
  }

  /**
   * Get bundler address for wallet
   */
  async getBundlerAddress(walletAddress) {
    const bundlerAddress = await this.registry.readAddress(walletAddress);
    if (bundlerAddress === ethers.constants.AddressZero) return null;
    return bundlerAddress;
  }

  /**
   * Get existing bundler contract instance for wallet
   */
  async getBundler(walletAddress) {
    const bundlerAddress = await this.getBundlerAddress(walletAddress);
    if (!bundlerAddress) return null;

    return new ethers.Contract(bundlerAddress, WalletBundlerABI.abi, this.signer);
  }

  /**
   * Approve bundler contract to spend owner's tokens
   * @param tokenContract The token contract instance (already connected to signer)
   * @param bundlerAddress The bundler contract address
   * @param ownerAddress The owner's wallet address
   * @param amount The amount to approve (defaults to max uint256)
   */
  async approveBundler(tokenContract, bundlerAddress, ownerAddress, amount = ethers.constants.MaxUint256) {
    // Check current allowance
    const currentAllowance = await tokenContract.allowance(ownerAddress, bundlerAddress);

    // Only approve if current allowance is less than half of max (needs refresh)
    if (currentAllowance.lt(ethers.constants.MaxUint256.div(2))) {
      const tx = await tokenContract.approve(bundlerAddress, amount);
      await tx.wait();
      return true;
    }

    return false; // Already approved
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