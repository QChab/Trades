import { parentPort, workerData } from 'worker_threads';
import { ethers } from 'ethers';

const { length, targetSelectors, baseSignature } = workerData;
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
const targetLowerSet = new Set(targetSelectors.map(s => s.toLowerCase()));

// Pre-compute for speed
const basePrefix = baseSignature.substring(0, 16); // "encodeAndExecute"
const baseSuffix = baseSignature.substring(16); // "(address,uint256,...)"

// Recursive generator - optimized for speed
function searchSuffixes(currentSuffix, remainingLength) {
  if (remainingLength === 0) {
    const signature = basePrefix + currentSuffix + baseSuffix;
    const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(signature));
    const selector = hash.substring(0, 10);

    if (targetLowerSet.has(selector)) {
      parentPort.postMessage({
        found: true,
        length,
        name: basePrefix + currentSuffix,
        signature,
        selector,
        suffix: currentSuffix,
      });
      process.exit(0);
    }
    return;
  }

  // Recursively try all characters
  const charsetLen = CHARSET.length;
  for (let i = 0; i < charsetLen; i++) {
    searchSuffixes(currentSuffix + CHARSET[i], remainingLength - 1);
  }
}

// Start search
console.log(`Worker starting: searching ${length}-character suffixes`);
searchSuffixes('', length);

// If we get here, no match found
parentPort.postMessage({
  progress: true,
  length,
  checked,
  current: 'done'
});
