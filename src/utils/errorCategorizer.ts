/**
 * Centralized error categorization utility.
 *
 * Phase 4.2: This replaces the duplicated regex-based error classification that
 * previously lived in:
 *   - workflowOrchestrator.ts processTask catch block
 *   - agentTrigger.ts triggerAgent error handler
 *   - server.ts trigger-agent endpoint
 *
 * All three locations now call `categorizeError()` for consistent behaviour.
 */

export type ErrorCategory =
  | 'credit_limit'
  | 'model_error'
  | 'auth_error'
  | 'network_error'
  | 'timeout'
  | 'unknown';

export interface ErrorInfo {
  error: string;
  errorCategory: ErrorCategory;
  creditError?: boolean;
  modelError?: boolean;
  failedModel?: string;
  userMessage?: string;
}

/**
 * Inspects an Error (or error-like object) and returns a structured ErrorInfo
 * with the appropriate category and user-facing message.
 *
 * Supports the following detection strategies:
 *   1. Explicit flags on the error object (e.g. `error.creditError`, `error.modelError`).
 *   2. Pattern matching against `error.message` for common failure signatures.
 */
export function categorizeError(error: any): ErrorInfo {
  const message: string = error?.message || String(error);

  const info: ErrorInfo = {
    error: message,
    errorCategory: 'unknown',
  };

  // 1. Credit / usage limit
  if (error?.creditError || /usage.?limit|credit|quota/i.test(message)) {
    info.creditError = true;
    info.errorCategory = 'credit_limit';
    info.userMessage = 'AI credits exhausted. Please wait for credits to reset or upgrade your plan.';
    return info;
  }

  // 2. Model unavailable
  if (error?.modelError || /model.*unavailable/i.test(message)) {
    info.modelError = true;
    info.errorCategory = 'model_error';
    info.failedModel = error?.failedModel;
    info.userMessage = error?.failedModel
      ? `The AI model "${error.failedModel}" is unavailable. Try a different model.`
      : 'The selected AI model is unavailable. Try a different model.';
    return info;
  }

  // 3. Authentication / authorization
  if (/auth|unauthorized|not authenticated/i.test(message)) {
    info.errorCategory = 'auth_error';
    info.userMessage = 'AI agent authentication failed. Please re-authenticate.';
    return info;
  }

  // 4. Network
  if (/ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
    info.errorCategory = 'network_error';
    info.userMessage = 'A network error occurred. Please check your connection and try again.';
    return info;
  }

  // 5. Timeout
  if (/timeout|timed? ?out/i.test(message)) {
    info.errorCategory = 'timeout';
    info.userMessage = 'The operation timed out. Please try again.';
    return info;
  }

  // Fallback
  return info;
}

