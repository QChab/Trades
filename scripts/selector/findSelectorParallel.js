import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TARGET_SELECTORS = ['0x52bbbe29', '0x945bcec9', '0x3593564c', '0x286f580d', '0x750283bc', '0x049639fb', '0x30ace1b1', '0x0d5f0e3b', '0x0dc4bdae', '0x8af033fb', '0x638cc0fa'];
const BASE_SIGNATURE = 'encodeAndExecute(address,uint256,address,address[],bytes[],uint8[])';

// Launch workers for different suffix lengths
const lengths = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const workers = [];
const startTime = Date.now();

console.log(`🚀 Launching ${lengths.length} parallel workers...`);
console.log(`🎯 Target selectors: ${TARGET_SELECTORS.join(', ')}\n`);

for (const length of lengths) {
  const worker = new Worker(join(__dirname, 'selectorWorker.js'), {
    workerData: { length, targetSelectors: TARGET_SELECTORS, baseSignature: BASE_SIGNATURE }
  });

  worker.on('message', (msg) => {
    if (msg.found) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n✅ MATCH FOUND BY WORKER (length ${msg.length})!`);
      console.log(`   Function name: ${msg.name}`);
      console.log(`   Full signature: ${msg.signature}`);
      console.log(`   Selector: ${msg.selector}`);
      console.log(`   Suffix: "${msg.suffix}"`);
      console.log(`   Time: ${elapsed}s`);

      // Kill all workers
      workers.forEach(w => w.terminate());
      process.exit(0);
    } else if (msg.progress) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[Length ${msg.length}] ${msg.checked.toLocaleString()} checked in ${elapsed}s (${(msg.checked / elapsed).toFixed(0)}/s) - ${msg.current}`);
    }
  });

  worker.on('error', (err) => {
    console.error(`Worker error (length ${length}):`, err);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.log(`Worker (length ${length}) exited with code ${code}`);
    }
  });

  workers.push(worker);
}

// Timeout after 10 minutes
setTimeout(() => {
  console.log('\n⏰ Timeout reached, no match found');
  workers.forEach(w => w.terminate());
  process.exit(1);
}, 600000);
