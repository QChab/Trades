const { ethers } = require('ethers');

// Contract addresses
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const UNIVERSAL_ROUTER_ADDRESS = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

// Example token addresses (mainnet)
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// PERMIT2 max approval amount (2^160 - 1)
// Note: PERMIT2 uses uint160 for amounts, NOT uint256 like regular ERC20 approvals
const PERMIT2_MAX_ALLOWANCE = '1461501637330902918203684832716283019655932542975';

// Helper function to get correct max approval amount based on spender
function getMaxApprovalAmount(spender) {
  return spender.toLowerCase() === PERMIT2_ADDRESS.toLowerCase() 
    ? PERMIT2_MAX_ALLOWANCE 
    : ethers.constants.MaxUint256;
}

// WalletBundler ABI
const WALLET_BUNDLER_ABI = [
  'constructor()',
  'function owner() view returns (address)',
  'function batchApprove(address[] tokens, address[] spenders, uint256[] amounts, address[] permit2Spenders)',
  'function executeBundleWithTransfers(address fromToken, uint256 fromAmount, address[] targets, bytes[] data, uint256[] values, address[] outputTokens) payable returns (bool[] results, bytes[] returnData)',
  'function withdraw(address token, uint256 amount)',
  'event TradeExecuted(address indexed target, bool success, bytes returnData)',
  'event FundsTransferred(address indexed token, uint256 amount, address indexed recipient)',
  'event TokenApproved(address indexed token, address indexed spender, uint256 amount)',
  'event Permit2Approved(address indexed token, address indexed spender, uint160 amount, uint48 expiration)'
];

// ERC20 ABI for token interactions
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

async function deployWalletBundler(signer) {
  console.log('Deploying WalletBundler contract...');
  
  // Get contract factory
  const WalletBundler = new ethers.ContractFactory(
    WALLET_BUNDLER_ABI,
    WALLET_BUNDLER_BYTECODE, // You'll need to compile the contract to get this
    signer
  );
  
  // Deploy contract
  const bundler = await WalletBundler.deploy();
  await bundler.deployed();
  
  console.log('WalletBundler deployed to:', bundler.address);
  return bundler;
}

async function approveTokensExample(bundler, signer) {
  console.log('\n--- Batch Approve Example ---');
  
  // Example 1: Approve USDC to Balancer Vault (direct approval)
  // Example 2: Approve WETH to PERMIT2, then PERMIT2 to Universal Router
  
  const tokens = [USDC_ADDRESS, WETH_ADDRESS];
  const spenders = [BALANCER_VAULT_ADDRESS, PERMIT2_ADDRESS];
  const amounts = [
    getMaxApprovalAmount(BALANCER_VAULT_ADDRESS),  // MaxUint256 for regular contract
    getMaxApprovalAmount(PERMIT2_ADDRESS)          // Correct uint160 max for PERMIT2
  ];
  const permit2Spenders = [
    ethers.constants.AddressZero, // Not using PERMIT2 for USDC
    UNIVERSAL_ROUTER_ADDRESS       // Universal Router for WETH via PERMIT2
  ];
  
  console.log('Using approval amounts:');
  console.log('- USDC to Balancer:', amounts[0]);
  console.log('- WETH to PERMIT2:', amounts[1]);
  
  // First, approve the bundler to spend our tokens
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
  const weth = new ethers.Contract(WETH_ADDRESS, ERC20_ABI, signer);
  
  console.log('Approving bundler to spend USDC...');
  await (await usdc.approve(bundler.address, ethers.constants.MaxUint256)).wait();
  
  console.log('Approving bundler to spend WETH...');
  await (await weth.approve(bundler.address, ethers.constants.MaxUint256)).wait();
  
  // Now execute batch approve from the bundler
  console.log('Executing batch approve...');
  const tx = await bundler.batchApprove(tokens, spenders, amounts, permit2Spenders);
  const receipt = await tx.wait();
  
  console.log('Batch approve completed. Gas used:', receipt.gasUsed.toString());
  
  // Parse events
  receipt.logs.forEach((log) => {
    try {
      const parsed = bundler.interface.parseLog(log);
      console.log('Event:', parsed.name, parsed.args);
    } catch (e) {
      // Not a bundler event
    }
  });
}

/**
 * Generic function to execute trades through the WalletBundler
 * @param {ethers.Contract} bundler - The WalletBundler contract instance
 * @param {Object} tradeParams - Trade parameters
 * @param {string} tradeParams.fromToken - Input token address (0x0 for ETH)
 * @param {string} tradeParams.fromAmount - Amount of input token
 * @param {string[]} tradeParams.targets - Array of contract addresses to call
 * @param {string[]} tradeParams.data - Array of encoded calldata
 * @param {string[]} tradeParams.values - Array of ETH values for each call
 * @param {string[]} tradeParams.outputTokens - Array of expected output tokens
 * @param {string} tradeParams.ethValue - ETH value to send with transaction (optional)
 * @param {string} tradeParams.description - Description for logging
 */
async function executeTrade(bundler, tradeParams) {
  const {
    fromToken,
    fromAmount,
    targets,
    data,
    values,
    outputTokens,
    ethValue = '0',
    description = 'Trade'
  } = tradeParams;
  
  console.log(`\nExecuting ${description}...`);
  console.log('- From token:', fromToken === ethers.constants.AddressZero ? 'ETH' : fromToken);
  console.log('- From amount:', fromAmount);
  console.log('- Targets:', targets.length);
  console.log('- Calldata length:', data.map(d => d.length).join(', '));
  
  // Prepare transaction options
  const txOptions = ethValue !== '0' ? { value: ethValue } : {};
  
  // Execute the trade
  const tx = await bundler.executeBundleWithTransfers(
    fromToken,
    fromAmount,
    targets,
    data,
    values,
    outputTokens,
    txOptions
  );
  
  const receipt = await tx.wait();
  console.log(`${description} executed. Gas used:`, receipt.gasUsed.toString());
  
  // Parse and log events
  const tradeResults = [];
  const transfers = [];
  
  receipt.logs.forEach((log) => {
    try {
      const parsed = bundler.interface.parseLog(log);
      if (parsed.name === 'TradeExecuted') {
        tradeResults.push({
          target: parsed.args.target,
          success: parsed.args.success
        });
        console.log(`- Trade to ${parsed.args.target}: ${parsed.args.success ? 'Success' : 'Failed'}`);
      } else if (parsed.name === 'FundsTransferred') {
        const tokenSymbol = parsed.args.token === ethers.constants.AddressZero ? 'ETH' : 
                           parsed.args.token === WETH_ADDRESS ? 'WETH' :
                           parsed.args.token === USDC_ADDRESS ? 'USDC' : 'Token';
        const decimals = parsed.args.token === USDC_ADDRESS ? 6 : 18;
        const amount = ethers.utils.formatUnits(parsed.args.amount, decimals);
        
        transfers.push({
          token: parsed.args.token,
          amount: parsed.args.amount,
          recipient: parsed.args.recipient
        });
        console.log(`- Transferred ${amount} ${tokenSymbol} to ${parsed.args.recipient}`);
      }
    } catch (e) {
      // Not a bundler event
    }
  });
  
  return {
    receipt,
    tradeResults,
    transfers,
    success: tradeResults.every(r => r.success)
  };
}

async function executeTradeExample(bundler, signer) {
  console.log('\n--- Execute Trade Examples ---');
  
  // Example 1: Simple USDC -> WETH swap
  const usdcToWethTrade = {
    fromToken: USDC_ADDRESS,
    fromAmount: ethers.utils.parseUnits('100', 6), // 100 USDC
    targets: [UNIVERSAL_ROUTER_ADDRESS],
    data: ['0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000065a4a25000000000000000000000000000000000000000000000000000000000000000010b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000eb0b080604000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000000000005f5e100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'],
    values: ['0'],
    outputTokens: [WETH_ADDRESS, USDC_ADDRESS],
    description: '100 USDC -> WETH (Uniswap)'
  };
  
  await executeTrade(bundler, usdcToWethTrade);
  
  // Example 2: Multi-DEX arbitrage (Uniswap + Balancer)
  const arbitrageTrade = {
    fromToken: WETH_ADDRESS,
    fromAmount: ethers.utils.parseEther('1'), // 1 WETH
    targets: [UNIVERSAL_ROUTER_ADDRESS, BALANCER_VAULT_ADDRESS],
    data: [
      '0x3593564c...', // Uniswap calldata
      '0x52bbbe29...'  // Balancer calldata
    ],
    values: ['0', '0'],
    outputTokens: [USDC_ADDRESS, WETH_ADDRESS],
    description: '1 WETH arbitrage (Uniswap + Balancer)'
  };
  
  // Uncomment to test multi-DEX trade
  // await executeTrade(bundler, arbitrageTrade);
}

async function executeETHTradeExample(bundler, signer) {
  console.log('\n--- Execute ETH Trade Example ---');
  
  // Example: Swap 0.1 ETH for USDC
  const swapAmount = ethers.utils.parseEther('0.1');
  
  const ethToUsdcTrade = {
    fromToken: ethers.constants.AddressZero, // ETH
    fromAmount: '0', // 0 because ETH amount comes from ethValue
    targets: [UNIVERSAL_ROUTER_ADDRESS],
    data: ['0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000065a4a25000000000000000000000000000000000000000000000000000000000000000020b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000bb8a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000'],
    values: [swapAmount], // ETH to send to Universal Router
    outputTokens: [USDC_ADDRESS],
    ethValue: swapAmount, // ETH to send with transaction
    description: '0.1 ETH -> USDC (Uniswap)'
  };
  
  await executeTrade(bundler, ethToUsdcTrade);
}

async function withdrawExample(bundler) {
  console.log('\n--- Withdraw Example ---');
  
  // Withdraw all USDC
  console.log('Withdrawing all USDC from bundler...');
  const tx1 = await bundler.withdraw(USDC_ADDRESS, 0); // 0 means withdraw all
  await tx1.wait();
  console.log('USDC withdrawn');
  
  // Withdraw specific amount of ETH
  const ethAmount = ethers.utils.parseEther('0.05');
  console.log('Withdrawing 0.05 ETH from bundler...');
  const tx2 = await bundler.withdraw(ethers.constants.AddressZero, ethAmount);
  await tx2.wait();
  console.log('ETH withdrawn');
}


async function main() {
  // Setup provider and signer
  const provider = new ethers.providers.JsonRpcProvider('YOUR_RPC_URL');
  const signer = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);
  
  console.log('Using wallet:', signer.address);
  
  // Deploy or connect to existing bundler
  // const bundler = await deployWalletBundler(signer);
  
  // Or connect to existing bundler
  const BUNDLER_ADDRESS = 'YOUR_DEPLOYED_BUNDLER_ADDRESS';
  const bundler = new ethers.Contract(BUNDLER_ADDRESS, WALLET_BUNDLER_ABI, signer);
  
  // Verify ownership
  const owner = await bundler.owner();
  console.log('Bundler owner:', owner);
  
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error('Signer is not the bundler owner!');
  }
  
  // Execute examples
  await approveTokensExample(bundler, signer);
  await executeTradeExample(bundler, signer);
  // await executeETHTradeExample(bundler, signer);
  // await withdrawExample(bundler);
}

// Error handling
main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

// ============================================================================
// UTILITY FUNCTIONS FOR CALLDATA ENCODING (if needed for custom trading logic)
// ============================================================================

// Helper function to encode Uniswap V3 path
function encodePath(tokens, fees) {
  const FEE_SIZE = 3;
  
  if (tokens.length !== fees.length + 1) {
    throw new Error('Invalid path encoding');
  }
  
  let encoded = '0x';
  for (let i = 0; i < fees.length; i++) {
    encoded += tokens[i].slice(2);
    encoded += fees[i].toString(16).padStart(FEE_SIZE * 2, '0');
  }
  encoded += tokens[tokens.length - 1].slice(2);
  
  return encoded;
}

// Helper function to encode Uniswap Universal Router commands
function encodeUniversalRouterSwap(recipient, amountIn, amountOutMin, path, payerIsUser, deadline) {
  return ethers.utils.defaultAbiCoder.encode(
    ['bytes', 'bytes[]', 'uint256'],
    [
      '0x00', // V3_SWAP_EXACT_IN command
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'uint256', 'bytes', 'bool'],
          [
            recipient,
            amountIn,
            amountOutMin,
            path,
            payerIsUser
          ]
        )
      ],
      deadline
    ]
  );
}

// Helper function to encode Balancer swap
function encodeBalancerSwap(poolId, kind, assetIn, assetOut, amount, userData) {
  // Simplified - actual Balancer encoding is more complex
  const swapStruct = {
    poolId: poolId,
    kind: kind,
    assetIn: assetIn,
    assetOut: assetOut,
    amount: amount,
    userData: userData
  };
  
  return ethers.utils.defaultAbiCoder.encode(
    ['tuple(bytes32,uint8,address,address,uint256,bytes)'],
    [swapStruct]
  );
}

// Export for use in other scripts
module.exports = {
  WALLET_BUNDLER_ABI,
  PERMIT2_MAX_ALLOWANCE,
  getMaxApprovalAmount,
  deployWalletBundler,
  executeTrade,
  encodePath,
  encodeUniversalRouterSwap,
  encodeBalancerSwap
};