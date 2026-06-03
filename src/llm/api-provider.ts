/**
 * @file API 直连 LLM 提供商实现
 *
 * 通过 HTTP 请求直接调用 LLM API，支持两种提供商：
 * - Anthropic（Claude 系列）：使用 /v1/messages 端点
 * - OpenAI（GPT 系列）：使用 /v1/chat/completions 端点
 *
 * 此提供商为静默模式（非交互），适合自动化场景。
 */

import type { LLMProvider, LLMResponse } from "./provider.js";

/**
 * API 配置接口
 * 定义了直接调用 LLM API 所需的配置参数
 */
interface APIConfig {
  /** API 提供商：anthropic 或 openai */
  provider: "anthropic" | "openai";
  /** API 密钥 */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** 自定义 API 基础 URL（可选，用于代理或私有部署） */
  baseUrl?: string;
}

/**
 * API 直连 LLM 提供商类
 *
 * 实现了 LLMProvider 接口，通过 HTTP 请求直接与 LLM API 通信。
 * 支持 Anthropic 和 OpenAI 两种 API 格式。
 */
export class APIProvider implements LLMProvider {
  /** 提供商标识名称 */
  name = "api";
  /** 内部配置对象 */
  private config: APIConfig;

  /**
   * 构造函数
   * @param config - 部分 API 配置（可选），未提供的字段使用默认值或环境变量
   * @throws 当未找到 API 密钥时抛出错误
   */
  constructor(config?: Partial<APIConfig>) {
    this.config = {
      provider: config?.provider ?? "anthropic",
      /** 优先使用传入的 key，其次尝试环境变量 */
      apiKey: config?.apiKey ?? process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.OPENAI_API_KEY ?? "",
      model: config?.model ?? "claude-sonnet-4-6",
      baseUrl: config?.baseUrl,
    };
    if (!this.config.apiKey) {
      throw new Error("No API key found. Set ANTHROPIC_AUTH_TOKEN or OPENAI_API_KEY env var.");
    }
  }

  /** 非交互模式，返回 false */
  isInteractive() { return false; }

  /**
   * 发送 prompt 并获取 LLM 响应
   * 根据配置的提供商类型自动选择对应的 API 调用方法
   * @param prompt - 用户提示文本
   * @param system - 系统提示文本（可选）
   * @returns LLM 响应对象
   */
  async complete(prompt: string, system?: string): Promise<LLMResponse> {
    if (this.config.provider === "anthropic") {
      return this.callAnthropic(prompt, system);
    }
    return this.callOpenAI(prompt, system);
  }

  /**
   * 调用 Anthropic Messages API
   * @param prompt - 用户提示文本
   * @param system - 系统提示文本（可选）
   * @returns LLM 响应对象
   * @throws 当 API 返回错误时抛出异常
   */
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
      /** 提取响应文本内容 */
      content: data.content?.[0]?.text ?? "",
      /** 映射 token 使用量字段名 */
      usage: data.usage ? { prompt: data.usage.input_tokens, completion: data.usage.output_tokens } : undefined,
    };
  }

  /**
   * 调用 OpenAI Chat Completions API
   * @param prompt - 用户提示文本
   * @param system - 系统提示文本（可选）
   * @returns LLM 响应对象
   * @throws 当 API 返回错误时抛出异常
   */
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
      /** 提取响应文本内容 */
      content: data.choices?.[0]?.message?.content ?? "",
      /** 映射 token 使用量字段名 */
      usage: data.usage ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens } : undefined,
    };
  }
}
