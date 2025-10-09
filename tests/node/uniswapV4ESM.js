// Force loading of ESM module with fixed JSBI conversion
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Directly import from the ESM build where the JSBI error is fixed
const esmPath = join(__dirname, '../../node_modules/@uniswap/v4-sdk/dist/v4-sdk.esm.js');

// Dynamic import to force ESM module loading
const loadV4SDK = async () => {
  try {
    // Use file:// protocol to force ESM loading
    const module = await import(`file://${esmPath}`);
    return module;
  } catch (error) {
    console.error('Failed to load ESM module:', error);
    // Fallback to regular import
    return import('@uniswap/v4-sdk');
  }
};

// Export loaded module
export const getV4SDK = loadV4SDK();