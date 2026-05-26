import type { LLMProvider, LLMResponse } from "./provider.js";

interface APIConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class APIProvider implements LLMProvider {
  name = "api";
  private config: APIConfig;

  constructor(config?: Partial<APIConfig>) {
    this.config = {
      provider: config?.provider ?? "anthropic",
      apiKey: config?.apiKey ?? process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.OPENAI_API_KEY ?? "",
      model: config?.model ?? "claude-sonnet-4-6",
      baseUrl: config?.baseUrl,
    };
    if (!this.config.apiKey) {
      throw new Error("No API key found. Set ANTHROPIC_AUTH_TOKEN or OPENAI_API_KEY env var.");
    }
  }

  isInteractive() { return false; }

  async complete(prompt: string, system?: string): Promise<LLMResponse> {
    if (this.config.provider === "anthropic") {
      return this.callAnthropic(prompt, system);
    }
    return this.callOpenAI(prompt, system);
  }

  private async callAnthropic(prompt: string, system?: string): Promise<LLMResponse> {
    const url = this.config.baseUrl ?? "https://api.anthropic.com";
    const resp = await fetch(`${url}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        system: system ?? "You are a knowledge analysis engine. Always respond in valid JSON when asked.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json() as any;
    if (data.error) throw new Error(`Anthropic API error: ${data.error.message}`);
    return {
      content: data.content?.[0]?.text ?? "",
      usage: data.usage ? { prompt: data.usage.input_tokens, completion: data.usage.output_tokens } : undefined,
    };
  }

  private async callOpenAI(prompt: string, system?: string): Promise<LLMResponse> {
    const url = this.config.baseUrl ?? "https://api.openai.com";
    const resp = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        messages: [
          { role: "system", content: system ?? "You are a knowledge analysis engine. Always respond in valid JSON when asked." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await resp.json() as any;
    if (data.error) throw new Error(`OpenAI API error: ${data.error.message}`);
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      usage: data.usage ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens } : undefined,
    };
  }
}
