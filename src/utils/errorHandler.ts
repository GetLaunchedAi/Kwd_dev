import { logger } from './logger';

export class WorkflowError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public recoverable: boolean = false
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

/**
 * Handles errors with appropriate logging and recovery
 */
export function handleError(error: any, context: string): void {
  if (error instanceof WorkflowError) {
    logger.error(`[${context}] ${error.code}: ${error.message}`);
    if (error.recoverable) {
      logger.info(`[${context}] Error is recoverable, attempting recovery...`);
    }
  } else {
    logger.error(`[${context}] Unexpected error: ${error.message}`);
    if (error.stack) {
      logger.debug(`[${context}] Stack trace: ${error.stack}`);
    }
  }
}

/**
 * Wraps async functions with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context: string
): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (error: any) {
      handleError(error, context);
      throw error;
    }
  }) as T;
}















