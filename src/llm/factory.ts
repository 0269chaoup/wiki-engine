import type { LLMProvider } from "./provider.js";
import { APIProvider } from "./api-provider.js";
import { PipeProvider } from "./pipe-provider.js";

export interface LLMOptions {
  provider: "api" | "agent";
  apiProvider?: "anthropic" | "openai";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Create an LLM provider based on CLI options.
 *
 * --llm api    → APIProvider: silent, direct API call
 * --llm agent  → PipeProvider: Helios reads prompt, reasons in chat, writes back
 *
 * Returns null if provider creation fails (e.g. no API key) — commands that
 * don't need LLM can still run.
 */
export function createLLM(opts: LLMOptions): LLMProvider | null {
  if (opts.provider === "agent") {
    return new PipeProvider();
  }
  try {
    return new APIProvider({
      provider: opts.apiProvider ?? "anthropic",
      model: opts.model ?? "claude-sonnet-4-6",
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
    });
  } catch {
    return null;
  }
}
