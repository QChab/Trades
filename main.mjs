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
      INSERT INTO trades (fromAddress, fromTokenSymbol, fromTokenAddress, toTokenSymbol, toTokenAddress, fromAmount, expectedToAmount, txId, protocol, senderName)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
}

async function sendTransaction(transaction) {
  const warnings = [];

  try {
    const wallet = getWallet(transaction.from);

    const balance = await provider.getBalance(wallet.address);
    const balanceEth = Number(ethers.utils.formatEther(balance));
    if (balanceEth < 0.0005)
      throw new Error(`Eth Balance of address ${wallet.address} too low (< 0.0005)`)
    else if (balanceEth < 0.01)
      warnings.push(`Beware eth Balance of address ${wallet.address} low (< 0.01)`)
    
    console.log(transaction.contractAddress);

    const txData = {
      from: await wallet.getAddress(),
      to: transaction.contractAddress,
      data: transaction.callData,
      value: transaction.value,
      maxFeePerGas: ethers.utils.parseUnits((Number(gasPrice) * 1.85 / 1000000000).toFixed(3), 9),
      maxPriorityFeePerGas: ethers.utils.parseUnits((0.01 + Math.random() * .05 + (Number(gasPrice) / (40 * 1000000000))).toFixed(3), 9),
    }

    console.log(txData);
    let txResponse = await wallet.sendTransaction(txData);

    saveTradeInDB({...transaction.tradeSummary, txId: txResponse?.hash});

    return {success: true, warnings, tx: JSON.parse(JSON.stringify(txResponse))};
  } catch (err) {
    console.error(err);
    console.log(err);
    return {success: false, error: err.toString(), warnings};
  }
}

  const getWallet = (address) => {
    if (!privateKeys || !privateKeys.length) 
      throw new Error('No private keys found');

    const from = address.toLowerCase();
    const pk = privateKeys.find((PK) => PK.address.toLowerCase() === from);
    const PRIVATE_KEY = pk.pk;
    
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
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
    const wallet = getWallet(from);
    const balance = await provider.getBalance(wallet.address);
    const balanceEth = Number(ethers.utils.formatEther(balance));
    if (balanceEth < 0.0005)
      throw new Error(`Eth Balance of address ${wallet.address} too low (< 0.0005)`)
    else if (balanceEth < 0.01)
      warnings.push(`Beware eth Balance of address ${wallet.address} low (< 0.01)`);

    const overrides = {
      maxFeePerGas: ethers.utils.parseUnits((Number(gasPrice) * 1.85 / 1e9).toFixed(3), 9),
      maxPriorityFeePerGas: ethers.utils.parseUnits((0.02 + Math.random() * .05 + (Number(gasPrice) / (40 * 1e9))).toFixed(3), 9),
    };

    // 1. Approve ERC20 for spender (Permit2, Vault, or Router)
    const erc20 = new ethers.Contract(contractAddress, ERC20_ABI, wallet);
    let allowance = await erc20.allowance(from, spender);
    if (BigNumber.from(allowance).lt(BigNumber.from('100000000000000000000000000'))) {
      const tx = await erc20.approve(spender, '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', overrides);
      await tx.wait();
    }

    // 2. If spender is Permit2 and permit2Spender is provided, approve Permit2 for that spender
    if (spender.toLowerCase() === PERMIT2_ADDRESS.toLowerCase() && permit2Spender) {
      const PERMIT2_ABI = [
        "function approve(address token, address spender, uint160 amount, uint48 expiration) external",
        "function allowance(address owner, address token, address spender) view returns (uint160, uint48, uint48)",
      ];
      const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, wallet);

      let [p2allow] = await permit2Contract.allowance(from, contractAddress, permit2Spender);
      if (BigNumber.from(p2allow).lt(BigNumber.from('100000000000000000000000000'))) {
        const tx2 = await permit2Contract.approve(
          contractAddress,
          permit2Spender,
          '1000000000000000000000000000000000000000000000',
          Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 50, // 50 years
          overrides
        );
        await tx2.wait();
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
    const wallet = getWallet(tradeSummary.sender?.address?.toLowerCase());

    if (!tradeSummary.fromToken?.address) throw new Error('Missing from token address in trade details')
    if (!tradeSummary.toToken?.address) throw new Error('Missing to token address in trade details')
    if (!tradeSummary.sender?.address) throw new Error('Missing sender address in trade details')

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
    
    const balance = await provider.getBalance(wallet.address);
    const balanceEth = Number(ethers.utils.formatEther(balance));
    if (balanceEth < 0.0005)
      throw new Error(`Eth Balance of address ${wallet.address} too low (< 0.0005)`)
    else if (balanceEth < 0.01)
      warnings.push(`Beware eth Balance of address ${wallet.address} low (< 0.01)`)
    
    if (onlyEstimate) {
      const gasEstimate = await router
        .estimateGas
        .execute(...args);

      // 4) (Optional) Compute the total ETH cost as gasEstimate * gasPrice
      const estimatedCostWei = gasEstimate.mul(gasPrice);
      const estimatedCostEth = ethers.utils.formatEther(estimatedCostWei);
      return {success: true, estimatedCostEth}
    }

    const tx = await router.execute(
      ...args,
    )
    saveTradeInDB({...tradeSummary, txId: tx?.hash});

    return {success: true, warnings, tx: JSON.parse(JSON.stringify(tx))};
  } catch (err) {
    console.error(err);
    return {success: false, error: err.toString(), warnings};
  }
}
function savePendingOrder(order) {
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
    order.fromToken?.address,
    order.fromToken?.symbol,
    order.toToken?.address,
    order.toToken?.symbol,
    order.priceLimit,
    order.currentMarketPrice,
    order.orderType || 'take_profit',
    order.shouldSwitchTokensForLimit ? 1 : 0,
    order.sender?.address,
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
        resolve(rows || []);
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
}

// Create the window once the app is ready
app.whenReady().then(() => {
  createWindow();
  initDatabase();

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
  // This is the last chance to clean up resources before the app completely shuts down.
});
  

// Global error handling to catch any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Additional error logging or cleanup could be performed here
});