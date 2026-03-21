import * as CircuitBreaker from 'opossum';
import { Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

const logger = new Logger('GstCircuitBreaker');

// Options for Opossum Circuit Breaker
const circuitOptions = {
  timeout: 5000, // Time (ms) before a request is considered timed out
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 30000, // Time (ms) to wait before trying to close the circuit again
};

/**
 * Standard HTTP GET to the GST Portal/API
 */
const fetchGstDetails = async (gstin: string) => {
  // TODO: Replace with actual GST API endpoint and headers
  const response = await axios.get(
    `https://gst-portal-api.example.com/v1/verify/${gstin}`,
    {
      headers: { Authorization: `Bearer YOUR_GST_TOKEN` },
    },
  );
  return response.data;
};

// Create the circuit breaker instance
const gstCircuitBreaker = new CircuitBreaker(fetchGstDetails, circuitOptions);

// Attach event listeners for logging
gstCircuitBreaker.on('open', () =>
  logger.warn('GST API Circuit is OPEN! Falling back to graceful degradation.'),
);
gstCircuitBreaker.on('halfOpen', () =>
  logger.log('GST API Circuit is HALF-OPEN. Testing recovery...'),
);
gstCircuitBreaker.on('close', () =>
  logger.log('GST API Circuit is CLOSED. Normal operations resumed.'),
);
gstCircuitBreaker.on('fallback', () =>
  logger.warn('GST API Circuit Fallback triggered!'),
);

/**
 * Utility function to verify GSTIN using the Circuit Breaker
 */
export async function verifyGstinSafe(gstin: string): Promise<any> {
  try {
    const result = await gstCircuitBreaker.fire(gstin);
    return result;
  } catch (error: any) {
    logger.error(
      `GST Verification failed for ${gstin}`,
      error?.message || error,
    );

    // If the API responded with a 400 (Bad Request / Validation Error),
    // we should pass that through to the client without tripping the breaker as heavily
    const status = error?.response?.status;
    if (status >= 400 && status < 500) {
      throw new HttpException(
        'The GSTIN you entered seems invalid. Please check and try again.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // For timeouts, 500s, and network drops, trigger the standard gateway error
    throw new HttpException(
      'Failed to verify GSTIN. External service error.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
