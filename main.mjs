import { app, BrowserWindow, ipcMain, shell, powerSaveBlocker } from 'electron';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3/lib/sqlite3.js';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
// For read-rtf
import { RtfParser } from 'read-rtf/index.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const userDataPath = app.getPath('userData');
console.log(userDataPath)

const privateKeysPath = path.join(userDataPath, 'p.crypt');
let settings;
const settingsPath = path.join(userDataPath, 'settings.json');
const sourcePath = path.join(userDataPath, 'source.json');
const destinationPath = path.join(userDataPath, 'destination.json');
const stateStoreFile = path.join(userDataPath, 'window-state.json');
const infuraKeyFile = path.join(userDataPath, 'ik.json');
let infuraKeys = [];

import { ethers, BigNumber } from 'ethers';
const UNIVERSAL_ROUTER_ADDRESS = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
const BALANCER_VAULT_ADDRESS   = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// Nonce Management System for MEV-protected RPCs
class NonceManager {
  constructor() {
    this.nonces = new Map(); // address -> {localNonce, lastUsed, lastTxTime}
    this.STALE_TIME = 60000; // 1 minute in milliseconds
    this.MIN_TX_DELAY = 3000; // Minimum 3 seconds between transactions from same address (MEV blocker needs time)
  }

  async getNonce(address) {
    address = address.toLowerCase();
    const now = Date.now();
    const cached = this.nonces.get(address);
    
    // Check if we need to fetch from chain
    const needsRefresh = !cached || (now - cached.lastUsed > this.STALE_TIME);
    
    if (needsRefresh) {
      await this.refreshNonce(address);
    }
    
    // Check if we need to delay for MEV blocker to process previous tx
    if (cached && cached.lastTxTime) {
      const timeSinceLastTx = now - cached.lastTxTime;
      if (timeSinceLastTx < this.MIN_TX_DELAY) {
        const delayNeeded = this.MIN_TX_DELAY - timeSinceLastTx;
        console.log(`Delaying ${delayNeeded}ms before next transaction from ${address}`);
        await new Promise(resolve => setTimeout(resolve, delayNeeded));
      }
    }
    
    const data = this.nonces.get(address);
    console.log(`Using nonce ${data.localNonce} for ${address}`);
    return data.localNonce;
  }

  async refreshNonce(address) {
    address = address.toLowerCase();
    
    try {
      // Get both pending and latest to handle edge cases
      const [pendingNonce, latestNonce] = await Promise.all([
        provider.getTransactionCount(address, 'pending'),
        provider.getTransactionCount(address, 'latest')
      ]);
      
      // Use the higher of the two
      const chainNonce = Math.max(pendingNonce, latestNonce);
      
      // If we have a local nonce that's higher (recent unconfirmed tx), keep it
      const cached = this.nonces.get(address);
      const currentLocal = cached?.localNonce || 0;
      const finalNonce = Math.max(chainNonce, currentLocal);
      
      this.nonces.set(address, {
        localNonce: finalNonce,
        lastUsed: Date.now(),
        lastTxTime: cached?.lastTxTime || null
      });
      
      console.log(`Refreshed nonce for ${address}: chain=${chainNonce}, local=${currentLocal}, using=${finalNonce}`);
    } catch (err) {
      console.error('Failed to refresh nonce from chain:', err);
      // If we have a cached value and refresh fails, keep using it
      if (this.nonces.has(address)) {
        console.log('Using cached nonce due to refresh failure');
      } else {
        throw new Error(`Cannot get nonce for ${address}: ${err.message}`);
      }
    }
  }

  incrementNonce(address) {
    address = address.toLowerCase();
    const data = this.nonces.get(address);
    
    if (!data) {
      throw new Error(`No nonce data for ${address} - call getNonce first`);
    }
    
    const now = Date.now();
    data.localNonce += 1;
    data.lastUsed = now;
    data.lastTxTime = now; // Record when transaction was sent
    this.nonces.set(address, data);
    
    console.log(`Incremented nonce for ${address} to ${data.localNonce}`);
  }

  // Force refresh on transaction failure
  async handleTransactionError(address, error) {
    address = address.toLowerCase();
    
    // Check if it's a MEV blocker pending block error (likely nonce conflict)
    const isMevBlockerError = error.message && (
      error.message.includes('Failed in pending block') ||
      error.message.includes('Reverted')
    ) && error.code === 'SERVER_ERROR';
    
    // Check if it's a nonce-related error
    const isNonceError = error.message && (
      error.message.includes('nonce') ||
      error.message.includes('replacement transaction') ||
      error.code === 'NONCE_EXPIRED' ||
      error.code === -32000
    );
    
    if (isNonceError || isMevBlockerError) {
      console.log(`Transaction error detected for ${address} (MEV blocker: ${isMevBlockerError}), forcing refresh`);
      await this.refreshNonce(address);
      
      // For MEV blocker errors, increase the delay for next transaction
      if (isMevBlockerError) {
        const data = this.nonces.get(address);
        if (data) {
          // Add extra delay by setting lastTxTime to current time
          data.lastTxTime = Date.now();
          this.nonces.set(address, data);
          console.log(`Added extra delay for ${address} due to MEV blocker error`);
        }
      }
    }
  }

  // Clear stale entries periodically (optional cleanup)
  cleanupStale() {
    const now = Date.now();
    const staleTime = this.STALE_TIME * 10; // 10 minutes
    
    for (const [address, data] of this.nonces.entries()) {
      if (now - data.lastUsed > staleTime) {
        this.nonces.delete(address);
        console.log(`Cleaned up stale nonce for ${address}`);
      }
    }
  }
}

const nonceManager = new NonceManager();

const UNIVERSAL_ROUTER_ABI       = [
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable returns (bytes[] memory results)'
];

let db;

function initDatabase() {
  const dbPath = path.join(userDataPath, 'trades_complete.db');

  // Create or open the DB
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Failed to open/create DB:', err);
    } else {
      console.log('Connected to the SQLite database at', dbPath);

      db.run(`
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fromTokenAddress TEXT NOT NULL,
          toTokenAddress TEXT NOT NULL,
          fromTokenSymbol TEXT,
          toTokenSymbol TEXT,
          fromAmount TEXT,
          toAmount TEXT,
          expectedToAmount TEXT,
          slippage TEXT,
          txId TEXT,
          fromAddress TEXT,
          toAddress TEXT,
          gasPrice TEXT,
          protocol TEXT,
          senderName TEXT,
          timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
          isConfirmed BOOLEAN,
          hasFailed BOOLEAN,
          gasCost TEXT
        )
      `, (tableErr) => {
        if (tableErr) {
          console.error('Failed to create trades table:', tableErr);
        } else {
          console.log('trades table ready or already exists.');

          db.run(`ALTER TABLE trades ADD COLUMN type TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              console.error('Error adding type column:', err);
            }
          });
        }
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS PendingOrder (
          id INTEGER PRIMARY KEY,
          fromAmount TEXT,
          toAmount TEXT,
          fromTokenAddress TEXT,
          fromTokenSymbol TEXT,
          toTokenAddress TEXT,
          toTokenSymbol TEXT,
          priceLimit TEXT,
          currentMarketPrice TEXT,
          orderType TEXT DEFAULT 'take_profit',
          shouldSwitchTokensForLimit BOOLEAN DEFAULT 0,
          senderAddress TEXT,
          senderName TEXT,
          status TEXT DEFAULT 'pending',
          createdAt DATETIME DEFAULT (datetime('now', 'localtime')),
          completedAt DATETIME,
          executionPrice TEXT
        )
      `, (err) => {
        if (err) {
          console.error('Failed to create PendingOrder table:', err);
        } else {
          console.log('PendingOrder table ready or already exists.');
          
          // Add missing columns to existing table if they don't exist
          db.run(`ALTER TABLE PendingOrder ADD COLUMN toAmount TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              console.error('Error adding toAmount column:', err);
            }
          });
          db.run(`ALTER TABLE PendingOrder ADD COLUMN currentMarketPrice TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              console.error('Error adding currentMarketPrice column:', err);
            }
          });
          db.run(`ALTER TABLE PendingOrder ADD COLUMN orderType TEXT DEFAULT 'take_profit'`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              console.error('Error adding orderType column:', err);
            }
          });
          db.run(`ALTER TABLE PendingOrder ADD COLUMN shouldSwitchTokensForLimit BOOLEAN DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              console.error('Error adding shouldSwitchTokensForLimit column:', err);
            }
          });
          db.run(`ALTER TABLE PendingOrder ADD COLUMN completedAt DATETIME`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              console.error('Error adding completedAt column:', err);
            }
          });
          db.run(`ALTER TABLE PendingOrder ADD COLUMN executionPrice TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              console.error('Error adding executionPrice column:', err);
            }
          });
        }
      });
    }
  });
}

async function saveTradeInDB(trade) {
  try {
    const sql = `
      INSERT INTO trades (fromAddress, fromTokenSymbol, fromTokenAddress, toTokenSymbol, toTokenAddress, fromAmount, expectedToAmount, txId, protocol, senderName, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      trade.sender?.address,
      trade.fromToken?.symbol,
      trade.fromToken?.address,
      trade.toToken?.symbol,
      trade.toToken?.address,
      trade.fromAmount,
      trade.toAmount,
      trade.txId,
      trade.protocol,
      trade.sender?.name,
      trade.type,
    ], function (err) {
      if (err) {
        console.error('Failed to insert trade:', err);
      }
    });
  } catch (err) {
    console.error(err);
  }
}

function failTradeInDB(txId, gasCost) {
  const sql = `
    UPDATE trades
    SET hasFailed = 1,
        gasCost  = $gasCost
    WHERE  txId = $txId
  `;

  db.run(sql, { 
    $txId: txId.toLowerCase(),
    $gasCost: gasCost,
  }, function (err) {
    if (err) return console.error('❌ update fail failed:', err);
  });
}

function confirmTradeInDB (txId, gasCost, toAmount) {
  console.log(gasCost, toAmount)
  const sql = `
    UPDATE trades
    SET    isConfirmed = 1,
           gasCost  = $gasCost,
           toAmount   = $toAmount
    WHERE  txId        = $txId
  `;

  db.run(
    sql,
    {
      $txId:    txId.toLowerCase(),
      $gasCost: gasCost,   // make sure it’s numeric
      $toAmount: toAmount          // keep as string if you want full precision
    },
    function (err) {
      if (err) {
        console.error('❌ update confirm failed:', err);
      }
    }
  );
}

/**
 * Delete all trades with the given txID.
 * @param {string} txID  The transaction ID to delete.
 */
function deleteTrade(txID) {
  const sql = `DELETE FROM trades WHERE txID = ?;`;

  db.run(sql, [txID], function (err) {
    if (err) {
      console.error(`❌ Failed to delete trades for txID=${txID}:`, err);
    } else {
      console.log(`✅ Deleted ${this.changes} trade(s) with txID=${txID}`);
    }
  });
}

function deleteAllTrades() {
  const sql = `DELETE FROM trades;`;

  db.run(sql, function (err) {
    if (err) {
      console.error('❌ Failed to delete trades:', err);
    } else {
      console.log(`✅ All trades deleted (affected rows: ${this.changes})`);
    }
  });
}

let privateKeys;
let gasPrice;

function decryptRTF(rtf) {
  let qw = new RtfParser();
  qw.parse(rtf);
  return qw.rawText;
}

let rpcUrls = [];
let providersList;
let provider 

function refreshProviders () {
  if (!infuraKeys || !infuraKeys.length) return false;

  rpcUrls = infuraKeys;
  providersList = rpcUrls.map((url) => 
    new ethers.providers.JsonRpcProvider(url,{ chainId: 1, name: 'homestead' })
  );
  provider = new ethers.providers.FallbackProvider(providersList, 1);

  (async () => console.log(await provider.getTransactionCount('0x30c4b0ff44fc27d58fbbcf0405799c36d12da62e', 'pending')))()
}

async function sendTransaction(transaction) {
  const warnings = [];

  try {
    const wallet = getWallet(transaction.from, true);
    const walletAddress = await wallet.getAddress();

    const balance = await provider.getBalance(walletAddress);
    const balanceEth = Number(ethers.utils.formatEther(balance));
    if (balanceEth < 0.0005)
      throw new Error(`Eth Balance of address ${walletAddress} too low (< 0.0005)`)
    else if (balanceEth < 0.01)
      warnings.push(`Beware eth Balance of address ${walletAddress} low (< 0.01)`)
    
    console.log(transaction.contractAddress);

    let nonce;
    
    // If a nonce is explicitly provided (for mixed trades), use it with a delay
    if (transaction.nonce !== undefined && transaction.nonce !== null) {
      nonce = transaction.nonce;
      console.log(`Using provided nonce ${nonce} for mixed trade, waiting 900ms...`);
      await new Promise(r => setTimeout(r, 900));
      
      // Update the NonceManager's cache to keep it in sync
      const data = nonceManager.nonces.get(walletAddress.toLowerCase());
      if (data && data.localNonce <= nonce) {
        data.localNonce = nonce + 1;
        data.lastUsed = Date.now();
        data.lastTxTime = Date.now();
        nonceManager.nonces.set(walletAddress.toLowerCase(), data);
      }
    } else {
      // Get nonce from NonceManager for regular trades
      nonce = await nonceManager.getNonce(walletAddress);
    }

    const txData = {
      from: walletAddress,
      to: transaction.contractAddress,
      data: transaction.callData,
      value: transaction.value,
      maxFeePerGas: transaction.maxFeePerGas || ethers.utils.parseUnits((Number(gasPrice) * 1.85 / 1000000000).toFixed(3), 9),
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas || ethers.utils.parseUnits((0.01 + Math.random() * .05 + (Number(gasPrice) / (40 * 1000000000))).toFixed(3), 9),
      nonce: nonce
    }

    console.log(txData);
    
    let txResponse;
    try {
      txResponse = await wallet.sendTransaction(txData);
      console.log(`Transaction sent with nonce ${txResponse?.nonce}, hash: ${txResponse?.hash}`);
      
      // Only increment nonce if we got it from NonceManager (not for provided nonces)
      if (transaction.nonce === undefined || transaction.nonce === null) {
        nonceManager.incrementNonce(walletAddress);
      }
    } catch (err) {
      // Handle nonce errors
      await nonceManager.handleTransactionError(walletAddress, err);
      throw err;
    }

    saveTradeInDB({...transaction.tradeSummary, txId: txResponse?.hash});

    return {success: true, warnings, tx: JSON.parse(JSON.stringify(txResponse))};
  } catch (err) {
    console.error(err);
    console.log(err);
    return {success: false, error: err.toString(), warnings};
  }
}

  const getWallet = (address, isPrivate) => {
    if (!privateKeys || !privateKeys.length) 
      throw new Error('No private keys found');

    const from = address.toLowerCase();
    const pk = privateKeys.find((PK) => PK.address.toLowerCase() === from);
    const PRIVATE_KEY = pk.pk;
    
    const wallet = new ethers.Wallet(PRIVATE_KEY, isPrivate ? 
      new ethers.providers.JsonRpcProvider('https://rpc.mevblocker.io', { chainId: 1, name: 'homestead' }) : provider);

    if (!wallet || !wallet.address || wallet.address.toLowerCase() !== from) {
      throw new Error(`Incorrect private key for address ${transfer.from}`)
    }
    return wallet;
  }

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

// APPROVE TOKEN OF SPENDER FOR PERMIT2 OR TOKEN CONTRACT
async function approveSpender({ from, contractAddress, spender, permit2Spender }) {
  const warnings = [];
  try {
    // Validate input parameters
    if (!from || !ethers.utils.isAddress(from)) {
      throw new Error('Invalid from address: ' + from);
    }
    if (!contractAddress || !ethers.utils.isAddress(contractAddress)) {
      throw new Error('Invalid contract address: ' + contractAddress);
    }
    if (!spender || !ethers.utils.isAddress(spender)) {
      throw new Error('Invalid spender address: ' + spender);
    }
    if (permit2Spender && !ethers.utils.isAddress(permit2Spender)) {
      throw new Error('Invalid permit2Spender address: ' + permit2Spender);
    }
    
    const wallet = getWallet(from);
    const walletAddress = await wallet.getAddress();
    const balance = await provider.getBalance(walletAddress);
    const balanceEth = Number(ethers.utils.formatEther(balance));
    if (balanceEth < 0.0004)
      throw new Error(`Eth Balance of address ${walletAddress} too low (< 0.0005)`)
    else if (balanceEth < 0.01)
      warnings.push(`Beware eth Balance of address ${walletAddress} low (< 0.01)`);

    // Get nonce for first transaction
    let nonce = await nonceManager.getNonce(walletAddress);

    const overrides = {
      maxFeePerGas: ethers.utils.parseUnits((Number(gasPrice) * 1.85 / 1e9).toFixed(3), 9),
      maxPriorityFeePerGas: ethers.utils.parseUnits((0.02 + Math.random() * .05 + (Number(gasPrice) / (40 * 1e9))).toFixed(3), 9),
      nonce: nonce
    };

    // 1. Approve ERC20 for spender (Permit2, Vault, or Router)
    const erc20 = new ethers.Contract(contractAddress, ERC20_ABI, wallet);
    let allowance = await erc20.allowance(from, spender);
    if (BigNumber.from(allowance).lt(BigNumber.from('100000000000000000000000000'))) {
      try {
        const tx = await erc20.approve(spender, '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', overrides);
        console.log(`ERC20 approval sent with nonce ${nonce}, hash: ${tx?.hash}`);
        nonceManager.incrementNonce(walletAddress);
        await tx.wait();
        nonce = await nonceManager.getNonce(walletAddress); // Get updated nonce for next transaction
      } catch (err) {
        await nonceManager.handleTransactionError(walletAddress, err);
        throw err;
      }
    }
    console.log('Allowance approved for', contractAddress, 'to', spender);

    // 2. If spender is Permit2 and permit2Spender is provided, approve Permit2 for that spender
    if (spender.toLowerCase() === PERMIT2_ADDRESS.toLowerCase() && permit2Spender) {
      const PERMIT2_ABI = [
        "function approve(address token, address spender, uint160 amount, uint48 expiration) external",
        "function allowance(address owner, address token, address spender) view returns (uint160, uint48, uint48)",
      ];
      const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, wallet);

      let [p2allow] = await permit2Contract.allowance(from, contractAddress, permit2Spender);
      if (BigNumber.from(p2allow).lt(BigNumber.from('100000000000000000000000000'))) {
        const overrides2 = { ...overrides, nonce };
        try {
          const tx2 = await permit2Contract.approve(
            contractAddress,
            permit2Spender,
            '1000000000000000000000000000000000000000000000',
            Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 50, // 50 years
            overrides2
          );
          console.log(`Permit2 approval sent with nonce ${nonce}, hash: ${tx2?.hash}`);
          nonceManager.incrementNonce(walletAddress);
          await tx2.wait();
        } catch (err) {
          await nonceManager.handleTransactionError(walletAddress, err);
          throw err;
        }
      }
    }

    return { success: true, warnings };
  } catch (err) {
    console.error(err);
    return { success: false, error: err.toString(), warnings };
  }
}

async function sendTrade({tradeSummary, args, onlyEstimate}) {
  const warnings = [];
  console.log(tradeSummary);
  
  try {
    const wallet = getWallet(tradeSummary.sender?.address?.toLowerCase(), true);

    if (!tradeSummary.fromToken?.address) throw new Error('Missing from token address in trade details')
    if (!tradeSummary.toToken?.address) throw new Error('Missing to token address in trade details')
    if (!tradeSummary.sender?.address) throw new Error('Missing sender address in trade details')
    
    // Validate addresses
    if (!ethers.utils.isAddress(tradeSummary.fromToken.address) && tradeSummary.fromToken.address !== ethers.constants.AddressZero) {
      throw new Error('Invalid from token address: ' + tradeSummary.fromToken.address);
    }
    if (!ethers.utils.isAddress(tradeSummary.toToken.address) && tradeSummary.toToken.address !== ethers.constants.AddressZero) {
      throw new Error('Invalid to token address: ' + tradeSummary.toToken.address);
    }
    if (!ethers.utils.isAddress(tradeSummary.sender.address)) {
      throw new Error('Invalid sender address: ' + tradeSummary.sender.address);
    }

    if (tradeSummary.fromToken.address !== ethers.constants.AddressZero) {
      const erc20 = new ethers.Contract(
        tradeSummary?.fromToken?.address,
        ERC20_ABI,
        provider
      );
      let rawAllowance = await erc20.allowance(wallet.address, PERMIT2_ADDRESS);
      if (Number(rawAllowance) === 0) {
        throw new Error('Insufficient allowance on ' + tradeSummary.fromToken.symbol);
      }

      const PERMIT2_ABI = [
        "function approve(address token, address spender, uint160 amount, uint48 expiration) external",
        "function allowance(address owner, address token, address spender) view returns (uint160, uint48, uint48)",
      ];
      const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, wallet);

      let results = await permit2Contract.allowance(wallet.address, tradeSummary?.fromToken?.address, UNIVERSAL_ROUTER_ADDRESS);
      if (!results || !results[0] || results[0]?.toString() === '0' || Number(results[0].toString()) < 1e26) {
        throw new Error('Insufficient allowance on ' + tradeSummary.fromToken.symbol + ' on PERMIT2');
      }
    }
    const router = new ethers.Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, wallet);
    
    const walletAddress = await wallet.getAddress();
    const balance = await provider.getBalance(walletAddress);
    const balanceEth = Number(ethers.utils.formatEther(balance));
    if (balanceEth < 0.0005)
      throw new Error(`Eth Balance of address ${walletAddress} too low (< 0.0005)`)
    else if (balanceEth < 0.01)
      warnings.push(`Beware eth Balance of address ${walletAddress} low (< 0.01)`)
    
    if (onlyEstimate) {
      const gasEstimate = await router
        .estimateGas
        .execute(...args);

      // 4) (Optional) Compute the total ETH cost as gasEstimate * gasPrice
      const estimatedCostWei = gasEstimate.mul(gasPrice);
      const estimatedCostEth = ethers.utils.formatEther(estimatedCostWei);
      return {success: true, estimatedCostEth}
    }

    // Get nonce from NonceManager
    const nonce = await nonceManager.getNonce(walletAddress);
    
    // Add nonce to the transaction overrides (last argument)
    const argsWithNonce = [...args];
    if (argsWithNonce.length > 0) {
      const lastArg = argsWithNonce[argsWithNonce.length - 1];
      // Check if last arg is overrides object
      if (typeof lastArg === 'object' && !Array.isArray(lastArg) && !BigNumber.isBigNumber(lastArg)) {
        // Add nonce to existing overrides
        argsWithNonce[argsWithNonce.length - 1] = { ...lastArg, nonce };
      } else {
        // Add new overrides object with nonce
        argsWithNonce.push({ nonce });
      }
    } else {
      // This shouldn't happen for router.execute, but handle it
      argsWithNonce.push({ nonce });
    }

    let tx;
    try {
      tx = await router.execute(...argsWithNonce);
      console.log(`Transaction sent with nonce ${tx?.nonce}, hash: ${tx?.hash}`);
      
      // Increment nonce after successful submission
      nonceManager.incrementNonce(walletAddress);
    } catch (err) {
      // Handle nonce errors
      await nonceManager.handleTransactionError(walletAddress, err);
      throw err;
    }
    
    saveTradeInDB({...tradeSummary, txId: tx?.hash});

    return {success: true, warnings, tx: JSON.parse(JSON.stringify(tx))};
  } catch (err) {
    console.error(err);
    return {success: false, error: err.toString(), warnings};
  }
}
function savePendingOrder(order) {
  // Validate token addresses before saving
  const fromTokenAddress = order.fromToken?.address;
  const toTokenAddress = order.toToken?.address;
  const senderAddress = order.sender?.address;
  
  if (!fromTokenAddress || !ethers.utils.isAddress(fromTokenAddress)) {
    console.error('Invalid fromToken address in savePendingOrder:', fromTokenAddress);
    return;
  }
  if (!toTokenAddress || !ethers.utils.isAddress(toTokenAddress)) {
    console.error('Invalid toToken address in savePendingOrder:', toTokenAddress);
    return;
  }
  if (!senderAddress || !ethers.utils.isAddress(senderAddress)) {
    console.error('Invalid sender address in savePendingOrder:', senderAddress);
    return;
  }
  
  const sql = `
    INSERT INTO PendingOrder (
      id, 
      fromAmount, 
      toAmount,
      fromTokenAddress, 
      fromTokenSymbol, 
      toTokenAddress, 
      toTokenSymbol, 
      priceLimit, 
      currentMarketPrice,
      orderType,
      shouldSwitchTokensForLimit,
      senderAddress, 
      senderName, 
      status, 
      createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  db.run(sql, [
    order.id,
    order.fromAmount,
    order.toAmount,
    fromTokenAddress,
    order.fromToken?.symbol,
    toTokenAddress,
    order.toToken?.symbol,
    order.priceLimit,
    order.currentMarketPrice,
    order.orderType || 'take_profit',
    order.shouldSwitchTokensForLimit ? 1 : 0,
    senderAddress,
    order.sender?.name,
    order.status || 'pending',
    order.createdAt || new Date().toISOString(),
  ], function (err) {
    if (err) {
      console.error('Failed to insert pending order:', err);
    } else {
      console.log('Pending order saved with ID:', order.id);
    }
  });
}

function updatePendingOrder(order) {
  const sql = `
    UPDATE PendingOrder 
    SET 
      status = ?,
      completedAt = ?,
      executionPrice = ?
    WHERE id = ?
  `;
  
  db.run(sql, [
    order.status,
    order.completedAt,
    order.executionPrice,
    order.id
  ], function (err) {
    if (err) {
      console.error('Failed to update pending order:', err);
    } else {
      console.log('Pending order updated with ID:', order.id);
    }
  });
}

function deletePendingOrder(id) {
  db.run(`DELETE FROM PendingOrder WHERE id = ?`, [id], function (err) {
    if (err) {
      console.error('Failed to delete pending order:', err);
    }
  });
}

function getAllPendingOrders() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM PendingOrder WHERE status = 'pending' ORDER BY createdAt DESC`, [], (err, rows) => {
      if (err) {
        console.error('Failed to fetch pending orders:', err);
        resolve([]); // Return empty array instead of rejecting
      } else {
        // Filter out orders with invalid addresses before returning
        const validOrders = (rows || []).filter(order => {
          const isValid = order.fromTokenAddress && 
                          order.toTokenAddress && 
                          order.senderAddress &&
                          ethers.utils.isAddress(order.fromTokenAddress) &&
                          ethers.utils.isAddress(order.toTokenAddress) &&
                          ethers.utils.isAddress(order.senderAddress);
          
          if (!isValid) {
            console.warn('Filtering out order with invalid addresses:', {
              id: order.id,
              fromTokenAddress: order.fromTokenAddress,
              toTokenAddress: order.toTokenAddress,
              senderAddress: order.senderAddress
            });
          }
          
          return isValid;
        });
        
        resolve(validOrders);
      }
    });
  });
}

/**
 * Encrypts or decrypts text with AES-256-ECB.
 * @param {string} text - The plaintext (for encrypt) or base64 ciphertext (for decrypt).
 * @param {string | Buffer} key - 32-byte key for AES-256. (256 bits)
 * @param {boolean} encrypt - If true, encrypt. If false, decrypt.
 * @returns {string} Encrypted text (base64) or decrypted text (utf8).
 */
function aes256Ecb(text, pwd, encrypt = true) {
  // "aes-256-ecb" => 256-bit key, ECB mode (no IV needed).
  // In Node, you pass null or an empty Buffer for the IV param in createCipheriv.
  const algorithm = "aes-256-ecb";

  const key = crypto.createHash('sha256')
    .update(pwd, 'utf8')
    .digest();

  // Create cipher or decipher
  const cipherObj = encrypt
    ? crypto.createCipheriv(algorithm, key, null)
    : crypto.createDecipheriv(algorithm, key, null);

  // For encryption, text is utf8 => output base64
  // For decryption, text is base64 => output utf8
  const inputEncoding = encrypt ? "utf8" : "base64";
  const outputEncoding = encrypt ? "base64" : "utf8";

  let result = cipherObj.update(text, inputEncoding, outputEncoding);
  result += cipherObj.final(outputEncoding);

  return result;
}

function loadWindowState() {
  // Valeur par défaut de l'état de la fenêtre en cas d'absence de fichier
  const defaultState = {
    width: 1400,      // largeur par défaut
    height: 1400,     // hauteur par défaut
    x: undefined,    // position horizontale (undefined pour centrer)
    y: undefined,    // position verticale (undefined pour centrer)
  };

  try {
    // Vérifie si le fichier existe
    if (fs.existsSync(stateStoreFile)) {
      // Lit le contenu du fichier de manière synchrone
      const data = fs.readFileSync(stateStoreFile, 'utf8');
      // Analyse le JSON et fusionne avec l'état par défaut
      const state = JSON.parse(data);
      return { ...defaultState, ...state };
    } else {
      // Si le fichier n'existe pas, retourne l'état par défaut
      return defaultState;
    }
  } catch (error) {
    // En cas d'erreur de lecture ou d'analyse, log et retourne les valeurs par défaut
    console.error('Erreur lors du chargement de létat de la fenêtre :', error);
    return defaultState;
  }
}

// =============================================================================
// Fonction pour sauvegarder l'état de la fenêtre sur le disque
// =============================================================================
function saveWindowState(win) {
  // Récupère les dimensions et la position actuelles de la fenêtre
  const bounds = win.getBounds(); // Renvoie un objet { x, y, width, height }
  
  try {
    // Écrit les informations au format JSON dans le fichier de manière synchrone
    fs.writeFileSync(stateStoreFile, JSON.stringify(bounds));
  } catch (error) {
    // Log en cas d'erreur lors de l'écriture du fichier
    console.error('Erreur lors de la sauvegarde de l’état de la fenêtre :', error);
  }
}


// Function to create the main window of the application
function createWindow() {
  let windowState = loadWindowState();

  // Create a new browser window with specified dimensions
  let mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Load the HTML file into the window
  mainWindow.loadFile('./vue-dist/index.html');

  // Optionally open the DevTools when in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Basic error handling for unresponsive window
  mainWindow.on('unresponsive', () => {
    console.error('Window is not responding.');
  });

  // When the window is actually closed, dereference it to help garbage collection
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Sauvegarde lors du redimensionnement
  mainWindow.on('resize', () => {
    // Sauvegarde l'état de la fenêtre à chaque redimensionnement
    saveWindowState(mainWindow);
  });
  
  // Sauvegarde lors du déplacement
  mainWindow.on('move', () => {
    // Sauvegarde l'état de la fenêtre à chaque déplacement
    saveWindowState(mainWindow);
  });
  
  // Sauvegarde lors de la fermeture de la fenêtre
  mainWindow.on('close', () => {
    // Sauvegarde l'état juste avant la fermeture
    saveWindowState(mainWindow);
  });  

  mainWindow.webContents.on('before-input-event', (event, input) => {
    // const isReload =
    //   (input.control || input.meta) &&
    //   (input.key.toLowerCase() === 'r' || input.code === 'F5');
  
    // if (isReload) {
    //   event.preventDefault(); // Block refresh
    //   console.log('[main] Blocked reload!');
    // }
  });

  ipcMain.handle('decrypt-rtf', (event, rtf) => {
    return decryptRTF(rtf);
  });

  if (fs.existsSync(infuraKeyFile)) {
    try {
      infuraKeys = JSON.parse(fs.readFileSync(infuraKeyFile)).filter((ik) => ik.startsWith('http'));
      refreshProviders();
    } catch (e) {
      console.error(e);
    }
  }

  ipcMain.handle('get-infura-keys', (event) => {
    return infuraKeys;
  })

  ipcMain.handle('save-infura-key', (event, infuraKey) => {
    if (infuraKeys) {
      infuraKeys.push(infuraKey);
      refreshProviders();
      fs.writeFileSync(infuraKeyFile, JSON.stringify(infuraKeys));
      return infuraKeys;
    }
  })

  ipcMain.handle('delete-infura-key', (event, index) => {
    if (infuraKeys) {
      if (index < 0) return infuraKeys;
      infuraKeys.splice(index, 1);
      refreshProviders();
      fs.writeFileSync(infuraKeyFile, JSON.stringify(infuraKeys));
      return infuraKeys;
    }
  })

  ipcMain.handle('is-file-detected', (event) => {
    return fs.existsSync(privateKeysPath);
  })

  // Uncipher private keys and load in the local private keys
  ipcMain.handle('load-private-keys', (event, pwd) => {
    try {
      const cipheredData = fs.readFileSync(privateKeysPath, 'utf8');
      const csvData = aes256Ecb(cipheredData, pwd, false);
      if (!csvData) return {success: false, error: 'Not the good format for saved pk'};

      const lines = csvData.split('\n');
      const firstLine = lines.splice(0, 1)[0];
      const columns = firstLine.split(',');

      if (columns[0] !== 'address' || columns[1] !== 'pk' || columns[2] !== 'name') return {success: false, error: 'Not the good columns in saved pk'}

      privateKeys = []
      for (const line of lines) {
        if (line === '') continue
        const values = line.split(',');
        if (values.length !== 3) return {success: false, error: 'Not the good values in saved pk'}
        if (!values[0] || !values[1] || !values[2]) continue;

        privateKeys.push({address: values[0], pk: values[1], name: values[2]});
      }
      return {addresses: privateKeys.map((pk) => ({address: pk.address.toLowerCase(), name: pk.name})), success: true};
    } catch (err) {
      console.error(err);
      if (err.toString().includes('BAD_DECRYPT'))
        return {success: false, error: 'Wrong password'}

      return {success: false, error: err.toString()}
    }
  })

  // Save the file and load the private keys locally
  ipcMain.handle('save-private-keys', (event, args) => {
    try {
      let csvData = 'address,pk,name\n'
      for (const pk of args.privateKeys) {
        if (!pk.address || !pk.pk) continue;
        csvData += pk.address.toLowerCase() + ',' + pk.pk + ',' + pk.name + '\n'
      }
      const cipheredData = aes256Ecb(csvData, args.password, true);
      fs.writeFileSync(privateKeysPath, cipheredData);

      privateKeys = args.privateKeys;
      return {success: true}
    } catch (err) {
      console.error(err);
      return {success: false, error: err.toString()}
    }
  });

  // Returns a missing address
  ipcMain.handle('check-private-keys', (event, addresses) => {
    for (const address of addresses) {
      if (!address) continue;
      if (!privateKeys) return {success: false, error: 'No private key'};
      if (!privateKeys.find((PK) => PK.address.toLowerCase() === address.toLowerCase())) return {success: true, addressWithoutPrivateKey: address};
    }
    
    return {success: true, addressWithoutPrivateKey: undefined};
  });

  ipcMain.handle('send-transaction', (event, transaction) => {
    return sendTransaction(transaction);
  });

  ipcMain.handle('send-trade', (event, trade) => {
    return sendTrade(trade);
  });
  
  ipcMain.handle('get-current-nonce', async (event, address) => {
    try {
      const nonce = await nonceManager.getNonce(address.toLowerCase());
      return { success: true, nonce };
    } catch (err) {
      console.error('Failed to get nonce:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('approve-spender', (event, from, contractAddress, spender, permit2Spender) => {
    return approveSpender({from, contractAddress, spender, permit2Spender});
  });

  ipcMain.handle('confirm-trade', (event, txId, gasCost, toAmount) => {
    return confirmTradeInDB(txId, gasCost, toAmount);
  });
  ipcMain.handle('fail-trade', (event, txId, gasCost) => {
    return failTradeInDB(txId, gasCost);
  });

  ipcMain.handle('save-addresses', (event, addresses, isSource) => {
    if (isSource)
      fs.writeFileSync(sourcePath, JSON.stringify(addresses));
    else
      fs.writeFileSync(destinationPath, JSON.stringify(addresses));
  });

  ipcMain.handle('read-addresses', (event, isSource) => {
    if (isSource) {
      if (!fs.existsSync(sourcePath)) return []
      else return JSON.parse(fs.readFileSync(sourcePath));
    }
    else {
      if (!fs.existsSync(destinationPath)) return []
      else return JSON.parse(fs.readFileSync(destinationPath));
    }
  });

  ipcMain.handle('set-gas-price', (event, currentGasPrice) => {
    gasPrice = currentGasPrice;
  });

  ipcMain.handle('save-pending-order', (event, order) => {
    savePendingOrder(order);
  });
  ipcMain.handle('update-pending-order', (event, order) => {
    updatePendingOrder(order);
  });
  ipcMain.handle('delete-pending-order', (event, id) => {
    deletePendingOrder(id);
  });
  ipcMain.handle('get-pending-orders', async () => {
    return await getAllPendingOrders();
  });

  ipcMain.handle('delete-history', (event) => {
    return deleteAllTrades();
  });

  ipcMain.handle('delete-trade', (event, txId) => {
    return deleteTrade(txId);
  });

  ipcMain.handle('open-url', (event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle('load-settings', (event) => {
    if (!fs.existsSync(settingsPath))
      return false;

    settings = JSON.parse(fs.readFileSync(settingsPath));
    
    // Validate token addresses when loading
    if (settings.tokens && Array.isArray(settings.tokens)) {
      settings.tokens = settings.tokens.map(token => {
        if (token && token.address) {
          // Trim and validate address
          const trimmedAddress = token.address.trim();
          
          // Only load if it's a valid address or empty
          if (trimmedAddress !== '' && ethers.utils.isAddress(trimmedAddress)) {
            return {
              ...token,
              address: trimmedAddress.toLowerCase()
            };
          } else {
            // Invalid address - return empty token
            console.log(`Invalid token address loaded: ${token.address}`);
            return {
              address: '',
              symbol: '',
              decimals: null,
              price: 0
            };
          }
        }
        return token;
      });
    }
    
    // Validate tokensInRow addresses when loading
    if (settings.tokensInRow && Array.isArray(settings.tokensInRow)) {
      settings.tokensInRow = settings.tokensInRow.map(row => {
        if (row && row.token && row.token.address) {
          const trimmedAddress = row.token.address.trim();
          
          if (trimmedAddress === '' || 
              trimmedAddress === ethers.constants.AddressZero ||
              ethers.utils.isAddress(trimmedAddress)) {
            return {
              ...row,
              token: {
                ...row.token,
                address: trimmedAddress.toLowerCase()
              }
            };
          } else {
            // Invalid address - clear the token
            console.log(`Invalid tokensInRow address loaded: ${row.token.address}`);
            return {
              ...row,
              token: { symbol: null, address: null, decimals: 18, price: null },
              columns: row.columns || []
            };
          }
        }
        return row;
      });
    }
    
    if (settings.amounts) {
      for (const amount of settings.amounts) {
        if (!amount.isRange) continue;
        amount.min = Number(amount.min);
        amount.max = Number(amount.max);
      }
    }
    return settings;
  });

  ipcMain.handle('save-settings', (event, newSettings) => {
    console.log('saving');
    
    // Validate and clean token addresses before saving
    if (newSettings.tokens && Array.isArray(newSettings.tokens)) {
      newSettings.tokens = newSettings.tokens.map(token => {
        if (token && token.address) {
          // Trim and validate address
          const trimmedAddress = token.address.trim();
          
          // Only save if it's a valid address or empty
          if (trimmedAddress === '' || 
              trimmedAddress === ethers.constants.AddressZero ||
              ethers.utils.isAddress(trimmedAddress)) {
            return {
              ...token,
              address: trimmedAddress.toLowerCase() // Store in lowercase
            };
          } else {
            // Invalid address - clear it
            return {
              address: '',
              symbol: '',
              decimals: null,
              price: 0
            };
          }
        }
        return token;
      });
    }
    
    // Validate tokensInRow addresses
    if (newSettings.tokensInRow && Array.isArray(newSettings.tokensInRow)) {
      newSettings.tokensInRow = newSettings.tokensInRow.map(row => {
        if (row && row.token && row.token.address) {
          const trimmedAddress = row.token.address.trim();
          
          if (trimmedAddress === '' || 
              trimmedAddress === ethers.constants.AddressZero ||
              ethers.utils.isAddress(trimmedAddress)) {
            return {
              ...row,
              token: {
                ...row.token,
                address: trimmedAddress.toLowerCase()
              }
            };
          } else {
            // Invalid address - clear the token
            return {
              ...row,
              token: { symbol: null, address: null, decimals: 18, price: null },
              columns: row.columns || []
            };
          }
        }
        return row;
      });
    }
    
    settings = newSettings;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
  });

  ipcMain.handle('get-trades', async (event) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM trades ORDER BY id DESC LIMIT 100`;
      db.all(sql, [], (err, rows) => {
        if (err) {
          console.error('Failed to fetch trades:', err);
          reject({ success: false, error: err.message });
        } else {
          resolve({ success: true, data: rows });
        }
      });
    });
  });

  ipcMain.handle('get-all-trades', async (event) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM trades ORDER BY id DESC`;
      db.all(sql, [], (err, rows) => {
        if (err) {
          console.error('Failed to fetch all trades:', err);
          reject({ success: false, error: err.message });
        } else {
          resolve({ success: true, data: rows });
        }
      });
    });
  });  
}

// Create the window once the app is ready
app.whenReady().then(() => {
  createWindow();
  initDatabase();
  
  // Set up periodic cleanup for stale nonces (every 5 minutes)
  const nonceCleanupInterval = setInterval(() => {
    nonceManager.cleanupStale();
  }, 5 * 60 * 1000);
  
  // Store interval ID for cleanup on quit
  global.nonceCleanupInterval = nonceCleanupInterval;

  // For macOS: Re-create a window when the dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Start a blocker to prevent the display from sleeping (screen stays on)
  const displayBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  console.log(`Display sleep blocker started with id: ${displayBlockerId}`);

  // Start another blocker to prevent the app from being suspended in the background
  const appBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  console.log(`App suspension blocker started with id: ${appBlockerId}`);
});

// Quit the application when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Listen for the 'before-quit' event to perform cleanup before quitting
// app.on('before-quit', (event) => {
app.on('before-quit', () => {
  console.log('App is about to quit. Performing pre-quit cleanup.');
  console.log(settings);
  // If asynchronous cleanup is needed, you could prevent the default quit:
  // event.preventDefault();
  // Perform async cleanup tasks here, then call app.quit() manually.
});

// Listen for the 'will-quit' event to handle final cleanup before the application exits
app.on('will-quit', () => {
  console.log('App will quit now. Final cleanup can be performed here.');
  // Clear the nonce cleanup interval
  if (global.nonceCleanupInterval) {
    clearInterval(global.nonceCleanupInterval);
  }
  // This is the last chance to clean up resources before the app completely shuts down.
});
  

// Global error handling to catch any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Additional error logging or cleanup could be performed here
});