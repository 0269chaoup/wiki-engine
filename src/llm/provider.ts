/**
 * LLM Provider abstraction.
 *
 * Two modes:
 *   api  — CLI calls LLM API directly (silent, for automation)
 *   pipe — CLI outputs prompt to stdout, reads response from stdin
 *          (designed for Helios: the AI agent reads prompt, reasons in chat,
 *           writes structured result back → full visualization)
 */

export interface LLMResponse {
  content: string;
  usage?: { prompt: number; completion: number };
}

export interface LLMProvider {
  name: string;
  /** Send prompt, get response */
  complete(prompt: string, system?: string): Promise<LLMResponse>;
  /** Whether this provider requires human interaction */
  isInteractive(): boolean;
}

/** Parse JSON from LLM response, with markdown code block extraction */
export function parseJSON<T = any>(text: string): T {
  // Strip markdown code blocks
  let cleaned = text.trim();
  const m = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) cleaned = m[1].trim();

  // Try direct parse first
  try { return JSON.parse(cleaned); } catch {}

  // Try finding JSON object/array in text
  const objMatch = cleaned.match(/[\[{][\s\S]*[\]]/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }

  throw new Error(`Failed to parse JSON from LLM response:\n${text.slice(0, 500)}`);
}
