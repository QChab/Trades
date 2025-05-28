import { ethers } from "ethers";
// -----------------------------------------------------------------------------
// 1) At the very top‐level we can now use `await` directly.
//    This code runs as soon as the module is imported.
// -----------------------------------------------------------------------------

// Fetch your Infura or RPC URLs from the Electron preload bridge:
const rpcUrls = await window.electronAPI.getInfuraKeys();

// -----------------------------------------------------------------------------
// 2) Build an array of JsonRpcProvider instances.
// -----------------------------------------------------------------------------
const providersList = rpcUrls.map((url) => {
  return new ethers.providers.JsonRpcProvider(
    url,
    {
      // Standard Ethereum mainnet settings:
      chainId: 1,
      name: 'homestead',
    }
  );
});

// -----------------------------------------------------------------------------
// 3) Instantiate a FallbackProvider around them.
// -----------------------------------------------------------------------------
const provider = new ethers.providers.FallbackProvider(
  providersList,
  1  // quorum: how many endpoints must respond
);

// -----------------------------------------------------------------------------
// 4) **Export** at the top level so there's no TS1258 error.
// -----------------------------------------------------------------------------
export default provider;