import * as readline from "readline";
import type { LLMProvider, LLMResponse } from "./provider.js";

/**
 * Pipe Provider — "Helios mode"
 *
 * Instead of calling an API, this provider:
 *   1. Prints the prompt as JSON to stdout
 *   2. Waits for a JSON response on stdin
 *
 * Designed to be orchestrated by Helios (the AI agent):
 *   - Helios spawns this CLI as a subprocess
 *   - Reads the prompt from stdout
 *   - Reasons about it (visible in chat = visualization!)
 *   - Writes the result back to stdin
 *   - CLI continues
 *
 * Protocol (JSON lines):
 *   → stdout: {"type":"prompt","id":"...","prompt":"...","system":"..."}
 *   ← stdin:  {"type":"response","id":"...","content":"..."}
 */
export class PipeProvider implements LLMProvider {
  name = "pipe";
  private pendingResolves = new Map<string, (value: string) => void>();
  private rl: readline.Interface;
  private promptCounter = 0;

  constructor() {
    // Read responses from stdin
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });
    this.rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "response" && msg.id && this.pendingResolves.has(msg.id)) {
          this.pendingResolves.get(msg.id)!(msg.content);
          this.pendingResolves.delete(msg.id);
        }
      } catch {}
    });
  }

  isInteractive() { return true; }

  async complete(prompt: string, system?: string): Promise<LLMResponse> {
    const id = `p${++this.promptCounter}`;

    // Output prompt as JSON line to stdout
    const msg = JSON.stringify({ type: "prompt", id, prompt, system });
    process.stdout.write(msg + "\n");

    // Wait for response
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResolves.delete(id);
        reject(new Error(`Pipe timeout waiting for response (id=${id}). Is Helios listening?`));
      }, 300_000); // 5 min timeout

      this.pendingResolves.set(id, (content) => {
        clearTimeout(timer);
        resolve({ content });
      });
    });
  }

  close() {
    this.rl.close();
  }
}
