import { config } from '../config/config';

export interface ModelValidationResult {
  valid: boolean;
  error?: string;
  availableModels?: string[];
}

/**
 * Validates a single model string against the configured available models.
 * Returns { valid: true } if the model is null/undefined/empty (optional) or is in the list.
 * Returns { valid: false, error, availableModels } if it fails validation.
 */
export function validateModel(model: string | undefined | null): ModelValidationResult {
  if (!model || typeof model !== 'string' || !model.trim()) {
    return { valid: true }; // Model is optional
  }

  const availableModels = config.cursor.availableModels || [];
  if (!availableModels.includes(model)) {
    return {
      valid: false,
      error: `Invalid model: ${model}`,
      availableModels,
    };
  }

  return { valid: true };
}

/**
 * Validates multiple named model fields (e.g. for demo creation with per-step models).
 * Returns { valid: true } if all pass, or { valid: false, error, availableModels } for the first failure.
 */
export function validateModelFields(
  fields: Record<string, string | undefined | null>
): ModelValidationResult {
  const availableModels = config.cursor.availableModels || [];

  for (const [fieldName, modelValue] of Object.entries(fields)) {
    if (modelValue && typeof modelValue === 'string' && modelValue.trim()) {
      if (!availableModels.includes(modelValue.trim())) {
        return {
          valid: false,
          error: `Invalid ${fieldName}: ${modelValue}. Available models: ${availableModels.join(', ')}`,
          availableModels,
        };
      }
    }
  }

  return { valid: true };
}

