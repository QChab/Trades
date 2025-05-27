// This script runs before the renderer process is loaded.
// It's used to safely expose Node.js features to the renderer.
// It uses Electron's contextBridge to expose safe APIs.

const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  sendTransaction: (transaction) => ipcRenderer.invoke('send-transaction', transaction),
  sendTrade: (trade) => ipcRenderer.invoke('send-trade', trade),
  confirmTrade: (trade) => ipcRenderer.invoke('confirm-trade', trade),
  setGasPrice: (gasPrice) => ipcRenderer.invoke('set-gas-price', gasPrice),
  decryptRtf: (fileContent) => ipcRenderer.invoke('decrypt-rtf', fileContent),
  savePrivateKeys: (privateKeys) => ipcRenderer.invoke('save-private-keys', privateKeys),
  loadPrivateKeys: (password) => ipcRenderer.invoke('load-private-keys', password),
  checkPrivateKeys: (addresses) => ipcRenderer.invoke('check-private-keys', addresses),
  isFileDetected: () => ipcRenderer.invoke('is-file-detected'),
  openURL: (url) => ipcRenderer.invoke('open-url', url),
  getTrades: () => ipcRenderer.invoke('get-trades'),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  deleteHistory: () => ipcRenderer.invoke('delete-history'),
  saveAddresses: (addresses, isSource) => ipcRenderer.invoke('save-addresses', addresses, isSource),
  readAddresses: (isSource) => ipcRenderer.invoke('read-addresses', isSource),
  deleteInfuraKey: (infuraKey) => ipcRenderer.invoke('delete-infura-key', infuraKey),
  saveInfuraKey: (infuraKey) => ipcRenderer.invoke('save-infura-key', infuraKey),
  getInfuraKeys: () => ipcRenderer.invoke('get-infura-keys'),
});