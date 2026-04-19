import type { RoutineParameter, RoutineParameterType } from '@hearth/shared';

/**
 * Validates that a parameter schema definition is well-formed.
 */
export function validateParameterSchema(parameters: RoutineParameter[]): { valid: boolean; error?: string } {
  const names = new Set<string>();
  for (const param of parameters) {
    if (!param.name || !param.type || !param.label) {
      return { valid: false, error: `Parameter "${param.name || '(unnamed)'}" is missing required fields` };
    }
    if (names.has(param.name)) {
      return { valid: false, error: `Duplicate parameter name: ${param.name}` };
    }
    names.add(param.name);
    if (param.type === 'enum' && (!param.options || param.options.length === 0)) {
      return { valid: false, error: `Enum parameter "${param.name}" must have options` };
    }
  }
  return { valid: true };
}

/**
 * Validates parameter values against a schema.
 */
export function validateParameterValues(
  schema: RoutineParameter[],
  values: Record<string, unknown>,
): { valid: boolean; error?: string } {
  for (const param of schema) {
    const value = values[param.name];
    if (param.required && value === undefined && param.default === undefined) {
      return { valid: false, error: `Required parameter "${param.label}" is missing` };
    }
    if (value !== undefined) {
      const typeError = validateType(param.name, param.type, value, param.options);
      if (typeError) return { valid: false, error: typeError };
    }
  }
  return { valid: true };
}

function validateType(name: string, type: RoutineParameterType, value: unknown, options?: string[]): string | undefined {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') return `Parameter "${name}" must be a string`;
      break;
    case 'number':
      if (typeof value !== 'number') return `Parameter "${name}" must be a number`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `Parameter "${name}" must be a boolean`;
      break;
    case 'enum':
      if (typeof value !== 'string' || (options && !options.includes(value))) {
        return `Parameter "${name}" must be one of: ${options?.join(', ')}`;
      }
      break;
    case 'date':
      if (typeof value !== 'string' || isNaN(Date.parse(value))) {
        return `Parameter "${name}" must be a valid date string`;
      }
      break;
    case 'date_range':
      if (typeof value !== 'object' || !value || !('start' in value) || !('end' in value)) {
        return `Parameter "${name}" must be an object with start and end dates`;
      }
      break;
  }
  return undefined;
}

/**
 * Resolves default values for parameters that aren't provided.
 */
export function resolveDefaults(
  schema: RoutineParameter[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = { ...values };
  for (const param of schema) {
    if (resolved[param.name] === undefined && param.default !== undefined) {
      resolved[param.name] = param.default;
    }
  }
  return resolved;
}

/**
 * Interpolates {{key}} placeholders in a prompt template with parameter values.
 * Simple regex-based — no template engine dependency.
 */
export function resolvePromptTemplate(prompt: string, values: Record<string, unknown>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = values[key];
    if (value === undefined) return match; // Leave unresolved tokens as-is
    return String(value);
  });
}
