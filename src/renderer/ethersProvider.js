import { ethers } from 'ethers';

// -- 1. Define your RPC endpoints:
//    Replace these URLs with whichever Ethereum mainnet RPC endpoints you prefer.
const rpcUrls = [
  "https://eth.llamarpc.com",
  "https://eth-mainnet.public.blastapi.io",
  "https://api.securerpc.com/v1",
  "https://eth1.lava.build",
  "https://rpc.mevblocker.io/fullprivacy",
  "https://eth.blockrazor.xyz",
  "https://eth.merkle.io",
];

// -- 2. Map each URL to a JsonRpcProvider instance:
//    - We pass the URL string and an options object indicating the chain.
//    - `chainId: 1` means Ethereum mainnet, and `name: 'homestead'` is the ethers.js
//      internal name for mainnet.
const providersList = rpcUrls.map((url) => {
  return new ethers.providers.JsonRpcProvider(
    url,
    {
      chainId: 1,
      name: 'homestead',
    }
  );
});

// -- 3. Create a FallbackProvider:
//    - Takes an array of ethers.providers.
//    - The second argument is the quorum: how many providers must respond
//      successfully for a call to be considered successful (default = 1).
//    - Here we set it explicitly to 1 so that any single healthy endpoint suffices.
const provider = new ethers.providers.FallbackProvider(
  providersList,
  1 // quorum: 1
);

export default provider;