/**
 * RPC Error Handler Utility
 * Handles rate limiting (429) and other RPC errors across the application
 */

/**
 * Check if an error is a 429 rate limit error
 * @param {Error} error - The error to check
 * @returns {boolean} True if it's a 429 error
 */
export function isRateLimitError(error) {
  // Axios error
  if (error.response && error.response.status === 429) {
    return true;
  }

  // Ethers provider error - check various formats
  if (error.code === 429) {
    return true;
  }

  // Some providers include status in error object
  if (error.status === 429) {
    return true;
  }

  // Check error message for rate limit indicators
  const message = error.message?.toLowerCase() || '';
  if (message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429')) {
    return true;
  }

  // Check if it's an ethers error with rate limit in reason
  if (error.reason?.toLowerCase().includes('rate limit')) {
    return true;
  }

  return false;
}

/**
 * Check if an error is an RPC error and extract status code
 * @param {Error} error - The error to check
 * @returns {{ isRpcError: boolean, statusCode?: number, message: string }}
 */
export function parseRpcError(error) {
  // Axios errors
  if (error.response) {
    return {
      isRpcError: true,
      statusCode: error.response.status,
      message: error.response.data?.message || error.message
    };
  }

  // Ethers provider errors
  if (error.code || error.status) {
    return {
      isRpcError: true,
      statusCode: error.code || error.status,
      message: error.reason || error.message
    };
  }

  // Generic error
  return {
    isRpcError: false,
    message: error.message || 'Unknown error'
  };
}

/**
 * Create a standardized error response
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {{ error: number, message: string }}
 */
export function createErrorResponse(statusCode, message = '') {
  return {
    error: statusCode,
    message: message || getDefaultErrorMessage(statusCode)
  };
}

/**
 * Get default error message for common status codes
 * @param {number} statusCode - HTTP status code
 * @returns {string} Default error message
 */
function getDefaultErrorMessage(statusCode) {
  const messages = {
    429: 'Rate limit exceeded. Please try again later.',
    403: 'Access forbidden',
    404: 'Resource not found',
    500: 'Internal server error',
    503: 'Service unavailable'
  };

  return messages[statusCode] || `Request failed with status ${statusCode}`;
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise<any>} Result of the function
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    shouldRetry = isRateLimitError,
    onRetry = null
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if it's not a retryable error
      if (!shouldRetry(error)) {
        throw error;
      }

      // Don't retry if we've exhausted attempts
      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      // Call retry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, delay, error);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries failed
  throw lastError;
}

/**
 * Setup global axios interceptor for 429 errors
 * @param {import('axios').AxiosInstance} axiosInstance - Axios instance to configure
 */
export function setupAxiosInterceptor(axiosInstance) {
  axiosInstance.interceptors.response.use(
    response => response,
    error => {
      if (isRateLimitError(error)) {
        console.warn('⚠️ Rate limit detected (429):', error.config?.url);
        // Optionally add retry logic here
      }
      return Promise.reject(error);
    }
  );
}

/**
 * Setup global ethers provider error handler
 * @param {import('ethers').providers.Provider} provider - Ethers provider
 */
export function setupProviderErrorHandler(provider) {
  // Store original send function
  const originalSend = provider.send.bind(provider);

  // Override send to catch rate limit errors
  provider.send = async function(...args) {
    try {
      return await originalSend(...args);
    } catch (error) {
      if (isRateLimitError(error)) {
        console.warn('⚠️ RPC rate limit detected:', args[0]);
        // Optionally add retry logic here
      }
      throw error;
    }
  };
}

export default {
  isRateLimitError,
  parseRpcError,
  createErrorResponse,
  retryWithBackoff,
  setupAxiosInterceptor,
  setupProviderErrorHandler
};
