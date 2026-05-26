import { VaultReader } from "./vault.js";
import { createLLM } from "../llm/factory.js";
import type { LLMOptions } from "../llm/factory.js";
import type { LLMProvider } from "../llm/provider.js";

export interface CLIContext {
  vault: VaultReader;
  llm: LLMProvider | null;
  verbose: boolean;
}

/** Build CLI context from parent command options */
export function buildContext(opts: any): CLIContext {
  const vault = new VaultReader(opts.vault);
  const llmOpts: LLMOptions = {
    provider: opts.llm ?? "api",
    apiProvider: opts.apiProvider ?? "anthropic",
    model: opts.model,
    apiKey: opts.apiKey,
  };
  const llm = createLLM(llmOpts);
  return { vault, llm, verbose: opts.verbose ?? false };
}

/** Require LLM — throw if not available */
export function requireLLM(ctx: CLIContext): LLMProvider {
  if (!ctx.llm) {
    throw new Error("This command requires an LLM provider. Set ANTHROPIC_AUTH_TOKEN or use --llm agent");
  }
  return ctx.llm;
}

/** Print a table row */
export function row(label: string, value: string | number, color?: string): void {
  const c = color ? `\x1b[${color}m` : "";
  const r = "\x1b[0m";
  console.log(`  ${c}${label.padEnd(24)}${r} ${value}`);
}

/** Format bytes */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
