// This file configures a global ethers.js provider that uses multiple RPC endpoints.
// We use ethers.providers.FallbackProvider to automatically try each RPC endpoint
// in case one fails, providing redundancy and potentially better performance.

import { JsonRpcProvider, FallbackProvider } from 'ethers';

// Define an array of RPC endpoint URLs. Replace these URLs with your own endpoints.
const rpcUrls = [
  "https://eth.llamarpc.com",
  "https://eth-mainnet.public.blastapi.io",
  "https://virginia.rpc.blxrbdn.com",
  "https://api.securerpc.com/v1",
  "https://eth1.lava.build",
  "https://rpc.mevblocker.io/fullprivacy",
  "https://eth.blockrazor.xyz",
  "https://eth.merkle.io",
];

// Map the URLs to ethers.js JsonRpcProvider instances.
const providersList = rpcUrls.map((url) => 
  new JsonRpcProvider(url,{ chainId: 1, name: 'homestead' })
);

// Create a FallbackProvider from the list of providers.
// The fallback provider will automatically switch between providers if one fails.
// Optionally, you can specify a quorum value as the second argument (default is 1).
const provider = new FallbackProvider(providersList, 1);

// Export the fallbackProvider for global use throughout your application.
export default provider;