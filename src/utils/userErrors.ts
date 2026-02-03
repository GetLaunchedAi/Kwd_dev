import { logger } from './logger';

/**
 * Maps technical error messages to user-friendly messages.
 * This prevents exposing internal implementation details to end users.
 */

// Common error patterns and their user-friendly equivalents
const ERROR_PATTERNS: Array<{ pattern: RegExp; message: string; }> = [
  // Network errors
  { pattern: /ECONNREFUSED/i, message: 'Unable to connect to the service. Please try again later.' },
  { pattern: /ECONNRESET/i, message: 'Connection was interrupted. Please try again.' },
  { pattern: /ETIMEDOUT/i, message: 'The request timed out. Please try again.' },
  { pattern: /ENOTFOUND/i, message: 'Service is temporarily unavailable. Please try again later.' },
  { pattern: /network\s*(error|failure)/i, message: 'Network error. Please check your connection and try again.' },
  { pattern: /socket hang up/i, message: 'Connection was lost. Please try again.' },
  
  // File system errors
  { pattern: /ENOENT.*no such file/i, message: 'The requested resource could not be found.' },
  { pattern: /ENOENT/i, message: 'The requested file or folder was not found.' },
  { pattern: /EACCES/i, message: 'Permission denied. Please contact support.' },
  { pattern: /EPERM/i, message: 'Operation not permitted. Please contact support.' },
  { pattern: /EEXIST/i, message: 'A resource with that name already exists.' },
  { pattern: /EBUSY/i, message: 'The file is currently in use. Please try again in a moment.' },
  { pattern: /ENOSPC/i, message: 'Storage space is full. Please contact support.' },
  { pattern: /EMFILE/i, message: 'Too many operations in progress. Please try again later.' },
  
  // Git errors
  { pattern: /fatal:.*not a git repository/i, message: 'This folder is not configured as a project.' },
  { pattern: /fatal:.*authentication failed/i, message: 'Git authentication failed. Please check your credentials.' },
  { pattern: /remote:.*repository not found/i, message: 'The repository could not be found. Please check the URL.' },
  { pattern: /merge conflict/i, message: 'There are conflicting changes that need to be resolved.' },
  { pattern: /git clone.*failed/i, message: 'Failed to clone the repository. Please verify the URL is correct.' },
  { pattern: /git push.*rejected/i, message: 'Changes could not be pushed. There may be conflicting updates.' },
  
  // API and HTTP errors
  { pattern: /401|unauthorized/i, message: 'Authentication required. Please log in and try again.' },
  { pattern: /403|forbidden/i, message: 'You do not have permission to perform this action.' },
  { pattern: /404|not found/i, message: 'The requested resource was not found.' },
  { pattern: /429|too many requests|rate.?limit/i, message: 'Too many requests. Please wait a moment and try again.' },
  { pattern: /500|internal server error/i, message: 'An unexpected error occurred. Please try again later.' },
  { pattern: /502|bad gateway/i, message: 'Service temporarily unavailable. Please try again later.' },
  { pattern: /503|service unavailable/i, message: 'Service is temporarily unavailable. Please try again later.' },
  { pattern: /504|gateway timeout/i, message: 'The request timed out. Please try again.' },
  
  // Cursor agent errors
  { pattern: /cursor-agent not found/i, message: 'AI agent is not available. Please contact support.' },
  { pattern: /cursor.*authentication/i, message: 'AI agent authentication issue. Please contact support.' },
  { pattern: /agent.*timeout/i, message: 'The AI agent took too long to respond. Please try again.' },
  { pattern: /completion detection timed out/i, message: 'The process took too long and was stopped. Please try again.' },
  
  // Cursor credit/usage limit errors
  { pattern: /usage.?limit|credit.?(limit|exhaust|exceed)|out of credits|no credits|quota.?(exceed|limit)/i, message: 'AI credits have been exhausted. Please wait for credits to reset or upgrade your plan.' },
  { pattern: /rate.?limit.*cursor|cursor.*rate.?limit/i, message: 'AI service rate limit reached. Please wait a few minutes and try again.' },
  { pattern: /billing|subscription|payment.*required/i, message: 'AI service billing issue. Please check your subscription status.' },
  { pattern: /model.*not available|model.*unavailable|cannot access.*model/i, message: 'The requested AI model is not available. Try selecting a different model.' },
  
  // Database/Storage errors
  { pattern: /SQLITE_BUSY/i, message: 'The database is busy. Please try again in a moment.' },
  { pattern: /SQLITE_LOCKED/i, message: 'The database is temporarily locked. Please try again.' },
  
  // Validation errors (pass through - these are often user-actionable)
  { pattern: /invalid.*(slug|name|format|pattern)/i, message: '$0' }, // Pass through validation messages
  { pattern: /required|missing/i, message: '$0' }, // Pass through validation messages
  
  // ClickUp API errors
  { pattern: /clickup.*token.*invalid/i, message: 'ClickUp connection expired. Please reconnect your account.' },
  { pattern: /clickup.*rate.?limit/i, message: 'ClickUp rate limit reached. Please try again in a moment.' },
  
  // Generic process errors
  { pattern: /spawn\s+\w+\s+ENOENT/i, message: 'A required tool is not installed. Please contact support.' },
  { pattern: /process exited with code/i, message: 'The operation failed. Please try again.' },
];

// Error codes with specific messages
const ERROR_CODE_MAP: Record<string, string> = {
  'DEMO_ALREADY_RUNNING': 'A demo is already being created. Please wait for it to complete.',
  'SLUG_NOT_AVAILABLE': 'This project name is already in use. Please choose a different name.',
  'INVALID_REPO_URL': 'The repository URL is invalid. Please check the URL and try again.',
  'TASK_NOT_FOUND': 'The requested task could not be found.',
  'CLIENT_NOT_FOUND': 'The requested client could not be found.',
  'WORKFLOW_IN_PROGRESS': 'A workflow is already running for this project.',
  'INVALID_FILE_TYPE': 'This file type is not supported.',
  'FILE_TOO_LARGE': 'The file is too large. Please reduce the file size.',
  'UPLOAD_FAILED': 'File upload failed. Please try again.',
  'CREDIT_LIMIT_EXCEEDED': 'AI credits have been exhausted. Please wait for credits to reset or upgrade your plan.',
  'CURSOR_CREDIT_ERROR': 'AI credits have been exhausted. Please wait for credits to reset or upgrade your plan.',
  'MODEL_UNAVAILABLE': 'The requested AI model is not available. Please select a different model.',
  'AGENT_AUTH_FAILED': 'AI agent authentication failed. Please re-authenticate cursor-agent.',
  'AGENT_TIMEOUT': 'The AI agent took too long to respond. Please try again.',
};

/**
 * Converts a technical error to a user-friendly message.
 * 
 * @param error - The error object or message
 * @param context - Optional context for logging (e.g., 'demo-creation', 'task-import')
 * @returns A user-friendly error message
 */
export function toUserFriendlyError(error: any, context?: string): string {
  const originalMessage = typeof error === 'string' ? error : (error?.message || 'Unknown error');
  
  // Log the original error for debugging
  if (context) {
    logger.debug(`[${context}] Original error: ${originalMessage}`);
  }
  
  // Check for error codes first (most specific)
  if (error?.code && ERROR_CODE_MAP[error.code]) {
    return ERROR_CODE_MAP[error.code];
  }
  
  // Check against known patterns
  for (const { pattern, message } of ERROR_PATTERNS) {
    if (pattern.test(originalMessage)) {
      // Handle passthrough patterns (validation messages)
      if (message === '$0') {
        // Clean up the original message slightly
        return cleanValidationMessage(originalMessage);
      }
      return message;
    }
  }
  
  // For unrecognized errors, return a generic message
  // but log the original for debugging
  logger.warn(`Unrecognized error (${context || 'unknown'}): ${originalMessage}`);
  
  // Check if it looks like a user-facing message already (no stack traces, short, no code jargon)
  if (isUserFriendlyMessage(originalMessage)) {
    return originalMessage;
  }
  
  return 'An unexpected error occurred. Please try again or contact support if the issue persists.';
}

/**
 * Checks if a message is already user-friendly (no technical jargon)
 */
function isUserFriendlyMessage(message: string): boolean {
  // Too long = likely technical
  if (message.length > 200) return false;
  
  // Contains stack trace indicators
  if (/^\s*at\s+/m.test(message)) return false;
  
  // Contains common code patterns
  if (/\.(js|ts|tsx|jsx):\d+/.test(message)) return false;
  
  // Contains error codes in ALL_CAPS format
  if (/\b[A-Z]{3,}_[A-Z_]+\b/.test(message) && !/\b(URL|API|ID)\b/.test(message)) return false;
  
  // Contains file paths
  if (/[\/\\][\w-]+[\/\\][\w-]+/.test(message)) return false;
  
  return true;
}

/**
 * Cleans up validation messages to be more readable
 */
function cleanValidationMessage(message: string): string {
  return message
    .replace(/^Error:\s*/i, '')
    .replace(/\.$/, '') + '.';
}

/**
 * Creates a standardized API error response with user-friendly message
 */
export function createErrorResponse(error: any, context?: string): { 
  success: false; 
  error: string; 
  code?: string;
} {
  return {
    success: false,
    error: toUserFriendlyError(error, context),
    ...(error?.code ? { code: error.code } : {})
  };
}

/**
 * Express middleware helper to wrap error responses
 */
export function wrapErrorResponse(res: any, error: any, statusCode: number = 500, context?: string): void {
  const userMessage = toUserFriendlyError(error, context);
  res.status(statusCode).json({ 
    success: false, 
    error: userMessage,
    ...(error?.code ? { code: error.code } : {})
  });
}

