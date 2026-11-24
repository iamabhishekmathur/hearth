/**
 * Pull a JSON object out of an LLM text response.
 *
 * Models often wrap JSON in a ```json fence or in prose ("Sure! Here it is: {…}").
 * A bare JSON.parse on that throws, and callers that swallow the error silently
 * drop the result (this dropped real decisions in decision-detector).
 *
 * 1. Prefer the contents of a ```json … ``` (or bare ``` … ```) fence.
 * 2. Narrow to the first `{` … last `}` span to strip leading/trailing prose.
 *
 * Returns the candidate string, or null when there is no object at all.
 */
export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  return objectMatch ? objectMatch[0] : null;
}
