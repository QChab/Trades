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

import { ethers } from 'ethers';  // v6 style

let db;

function initDatabase() {
  const dbPath = path.join(userDataPath, 'transfers.db');

  // Create or open the DB
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Failed to open/create DB:', err);
    } else {
      console.log('Connected to the SQLite database at', dbPath);

      db.run(`
        CREATE TABLE IF NOT EXISTS transfers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fromAddress TEXT NOT NULL,
          toAddress TEXT NOT NULL,
          tokenSymbol TEXT,
          amount TEXT,
          txId TEXT,
          timestamp DATETIME DEFAULT (datetime('now', 'localtime'))
        )
      `, (tableErr) => {
        if (tableErr) {
          console.error('Failed to create transfers table:', tableErr);
        } else {
          console.log('Transfers table ready or already exists.');
        }
      });
    }
  });
}

async function saveTransferInDB(transfer) {
  try {
    const sql = `
      INSERT INTO transfers (fromAddress, toAddress, tokenSymbol, amount, txId)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.run(sql, [transfer.from, transfer.to, transfer.token.symbol || '', transfer.amount || '', transfer.txId], function (err) {
      if (err) {
        console.error('Failed to insert transfer:', err);
      }
    });
  } catch (err) {
    console.error(err);
  }
}

function deleteAllTransfers() {
  const sql = `DELETE FROM transfers;`;

  db.run(sql, function (err) {
    if (err) {
      console.error('❌ Failed to delete transfers:', err);
    } else {
      console.log(`✅ All transfers deleted (affected rows: ${this.changes})`);
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

// import { FeeMarketEIP1559Transaction } from '@ethereumjs/tx';

// const rawTx = '0x02f8b10181a58401ab3f00843567e00083030d409491c65c2a9a3adfe2424ecc4a4890b8334c3a821280b844a9059cbb00000000000000000000000060f8b969d81abbd1378b359ca71a8a96f61749080000000000000000000000000000000000000000000000878678326eac900000c001a0b92262b4b8170022a53de7a3e516a5397a4434bd6a923286336acbe926891965a053596a674444203b1bd8a00a38d6826fd631af44e0ef13049ac38fce47cf5b93'
// const txData = Buffer.from(rawTx.slice(2), 'hex');
// const tx = FeeMarketEIP1559Transaction.fromSerializedTx(txData);
// const txDetails = tx.toJSON();
// console.log("Parsed Transaction Details:", txDetails);
// const senderAddress = tx.getSenderAddress().toString();
// console.log("Sender Address:", senderAddress);

let rpcUrls = [];
let providersList;
let provider 

function refreshProviders () {
  if (!infuraKeys || !infuraKeys.length) return false;

  rpcUrls = infuraKeys;
  providersList = rpcUrls.map((url) => 
    new ethers.JsonRpcProvider(url,{ chainId: 1, name: 'homestead' })
  );
  provider = new ethers.FallbackProvider(providersList, 1);  
}

async function sendTransfer(transfer) {
  if (!privateKeys) return {success: false, error: 'No private keys found'}
  const warnings = [];

  try {
    const from = transfer.from;
    const pk = privateKeys.find((PK) => PK.address.toLowerCase() === from.toLowerCase());
    const PRIVATE_KEY = pk.pk;
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    if (!wallet || !wallet.address || wallet.address.toLowerCase() !== transfer.from.toLowerCase()) {
      throw new Error(`Incorrect private key for address ${transfer.from}`)
    }
    
    if (!transfer.isTestMode) {
      const balance = await provider.getBalance(from);
      const balanceEth = Number(ethers.formatEther(balance));
      if (balanceEth < 0.001)
        throw new Error(`Eth Balance of address ${from} too low (< 0.001)`)
      else if (balanceEth < 0.01)
        warnings.push(`Beware eth Balance of address ${from} low (< 0.01)`)
    }

    const erc20Abi = [
      'function transfer(address to, uint256 value) returns (bool)',
    ];
    const tokenAddress = transfer.token.address;
    const erc20Contract = new ethers.Contract(tokenAddress, erc20Abi, provider);

    const recipient = transfer.to;
    const amount = ethers.parseUnits(transfer.amount.toString(), transfer.token.decimals);

    const txData = await erc20Contract['transfer'].populateTransaction(recipient, amount);
    txData.gasLimit = 500000;
    txData.maxFeePerGas = ethers.parseUnits((Number(gasPrice) * 1.45 / 1000000000).toFixed(3), 9);
    txData.maxPriorityFeePerGas = ethers.parseUnits((0.01 + Math.random() * .05 + (Number(gasPrice) / (50 * 1000000000))).toFixed(3), 9);
    console.log(txData);
    let txResponse;
    if (!transfer.isTestMode) {
      txResponse = await wallet.sendTransaction(txData);
    }
    saveTransferInDB({...transfer, txId: txResponse?.hash});

    return {success: true, warnings, txId: txResponse?.hash};
  } catch (err) {
    console.error(err);
    return {success: false, error: err.toString(), warnings};
  }
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

      if (columns[0] !== 'address' || columns[1] !== 'pk') return {success: false, error: 'Not the good columns in saved pk'}

      privateKeys = []
      for (const line of lines) {
        if (line === '') continue
        const values = line.split(',');
        if (values.length !== 2) return {success: false, error: 'Not the good values in saved pk'}
        if (!values[0] || !values[1]) continue;

        privateKeys.push({address: values[0], pk: values[1]});
      }
      return {success: true}
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
      let csvData = 'address,pk\n'
      for (const pk of args.privateKeys) {
        csvData += pk.address + ',' + pk.pk + '\n'
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

  ipcMain.handle('send-transfer', (event, transfer) => {
    return sendTransfer(transfer);
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

  ipcMain.handle('delete-history', (event) => {
    return deleteAllTransfers();
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
    settings = newSettings;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
  });

  ipcMain.handle('get-transfers', async (event) => {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM transfers ORDER BY id DESC LIMIT 100`;
      db.all(sql, [], (err, rows) => {
        if (err) {
          console.error('Failed to fetch transfers:', err);
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