import type { DeliveryRule, DeliveryTarget } from '@hearth/shared';

/**
 * Evaluates delivery rules against the routine output and any agent-set tags.
 * Returns the list of matched delivery targets.
 */
export function evaluateDeliveryRules(
  rules: DeliveryRule[],
  output: string,
  tags: string[] = [],
): DeliveryTarget[] {
  const matchedTargets: DeliveryTarget[] = [];

  for (const rule of rules) {
    if (matchesCondition(rule.condition, output, tags)) {
      matchedTargets.push(...rule.targets);
    }
  }

  return matchedTargets;
}

function matchesCondition(
  condition: DeliveryRule['condition'],
  output: string,
  tags: string[],
): boolean {
  switch (condition.type) {
    case 'always':
      return true;
    case 'contains':
      return condition.value ? output.toLowerCase().includes(condition.value.toLowerCase()) : false;
    case 'not_contains':
      return condition.value ? !output.toLowerCase().includes(condition.value.toLowerCase()) : true;
    case 'agent_tag':
      return condition.value ? tags.includes(condition.value) : false;
    default:
      return false;
  }
}

/**
 * Applies a delivery template to format the output for a specific channel.
 * Uses {{output}} as the placeholder for the routine output.
 */
export function applyTemplate(template: string | undefined, output: string): string {
  if (!template) return output;
  return template.replace(/\{\{output\}\}/g, output);
}
