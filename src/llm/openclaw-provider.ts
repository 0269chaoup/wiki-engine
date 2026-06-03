/**
 * @file OpenClaw 平台 LLM 提供商实现
 *
 * 读取 OpenClaw 的配置文件（~/.openclaw/openclaw.json）来获取主模型
 * 及其提供商信息（API 端点、密钥），然后直接调用 LLM。
 *
 * 支持 OpenClaw 使用的三种 API 类型：
 * - openai-completions：OpenAI 兼容格式（/v1/chat/completions）
 * - anthropic-messages：Anthropic 格式（/v1/messages）
 * - google-generative-ai：Google 格式（/v1beta/models/:model:generateContent）
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { LLMProvider, LLMResponse } from "./provider.js";

/**
 * OpenClaw 配置文件接口
 * 对应 ~/.openclaw/openclaw.json 的结构
 */
interface OpenClawConfig {
  /** 模型提供商配置 */
  models?: {
    /** 提供商映射表（key 为提供商名称） */
    providers?: Record<string, {
      /** API 类型（如 openai-completions、anthropic-messages 等） */
      api: string;
      /** API 基础 URL */
      baseUrl: string;
      /** API 密钥（可选，也可从 auth-profiles 读取） */
      apiKey?: string;
      /** 自定义请求头（可选） */
      headers?: Record<string, string>;
    }>;
  };
  /** 代理配置 */
  agents?: {
    /** 默认代理配置 */
    defaults?: {
      /** 默认模型配置 */
      model?: { primary?: string };
    };
    /** 代理列表 */
    list?: Array<{
      /** 代理 ID */
      id: string;
      /** 代理模型配置 */
      model?: { primary?: string };
    }>;
  };
}

/**
 * OpenClaw 认证配置接口
 * 对应 auth-profiles.json 中的单个 profile
 */
interface AuthProfile {
  /** 认证类型 */
  type: string;
  /** 提供商名称 */
  provider: string;
  /** API 密钥（可选） */
  key?: string;
  /** 访问令牌（可选，作为 key 的备选） */
  access?: string;
}

/**
 * OpenClaw 提供商内部配置接口
 * 经过解析后的最终可用配置
 */
interface OpenClawProviderConfig {
  /** 模型名称（不含提供商前缀），如 "mimo-v2.5-pro" */
  model: string;
  /** API 类型：openai-completions | anthropic-messages | google-generative-ai */
  apiType: string;
  /** API 基础 URL（已去除末尾斜杠） */
  baseUrl: string;
  /** API 密钥 */
  apiKey: string;
  /** 自定义请求头（可选） */
  headers?: Record<string, string>;
  /** 最大输出 token 数 */
  maxTokens: number;
}

/**
 * OpenClaw 平台 LLM 提供商类
 *
 * 实现了 LLMProvider 接口，通过读取 OpenClaw 配置文件来确定
 * 模型、API 端点和认证信息，支持三种主流 LLM API 格式。
 */
export class OpenClawProvider implements LLMProvider {
  /** 提供商标识名称 */
  name = "openclaw";
  /** 解析后的提供商配置 */
  private config: OpenClawProviderConfig;

  /**
   * 构造函数
   * 加载 OpenClaw 配置并解析出最终的提供商配置
   * @param opts - 可选配置：指定模型名称或代理 ID
   * @throws 当配置文件不存在或配置无效时抛出错误
   */
  constructor(opts?: { model?: string; agentId?: string }) {
    const ocConfig = this.loadOpenClawConfig();
    const resolved = this.resolveProvider(ocConfig, opts);
    this.config = resolved;
  }

  /** 非交互模式，返回 false */
  isInteractive() { return false; }

  /**
   * 发送 prompt 并获取 LLM 响应
   * 根据配置的 API 类型自动选择对应的调用方法
   * @param prompt - 用户提示文本
   * @param system - 系统提示文本（可选）
   * @returns LLM 响应对象
   */
  async complete(prompt: string, system?: string): Promise<LLMResponse> {
    switch (this.config.apiType) {
      case "anthropic-messages":
        return this.callAnthropic(prompt, system);
      case "google-generative-ai":
        return this.callGoogle(prompt, system);
      case "openai-completions":
      default:
        return this.callOpenAI(prompt, system);
    }
  }

  // ─── 配置加载 ──────────────────────────────────────────────

  /**
   * 加载 OpenClaw 配置文件
   * @returns 解析后的 OpenClaw 配置对象
   * @throws 当配置文件不存在时抛出错误
   */
  private loadOpenClawConfig(): OpenClawConfig {
    const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(`OpenClaw config not found: ${configPath}`);
    }
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  /**
   * 解析并确定最终的提供商配置
   *
   * 模型确定优先级：
   * 1. 显式指定的模型（必须是 provider/model 格式）
   * 2. 代理配置中指定的模型
   * 3. 默认配置中的模型
   *
   * @param oc - OpenClaw 配置对象
   * @param opts - 可选配置（模型名称、代理 ID）
   * @returns 解析后的提供商配置
   * @throws 当找不到模型或提供商配置时抛出错误
   */
  private resolveProvider(oc: OpenClawConfig, opts?: { model?: string; agentId?: string }): OpenClawProviderConfig {
    /** 1. 确定模型：显式指定 > 代理配置 > 默认配置 */
    let modelId = opts?.model;
    /** 忽略非 "provider/model" 格式的 CLI 默认值 */
    if (modelId && !modelId.includes("/")) {
      modelId = undefined;
    }
    /** 尝试从代理配置中获取模型 */
    if (!modelId && opts?.agentId) {
      const agent = oc.agents?.list?.find(a => a.id === opts.agentId);
      modelId = agent?.model?.primary;
    }
    /** 尝试使用默认模型 */
    if (!modelId) {
      modelId = oc.agents?.defaults?.model?.primary;
    }
    if (!modelId) {
      throw new Error("No model found in OpenClaw config (agents.defaults.model.primary)");
    }

    /** 2. 分割 "provider/model" 格式 → 提供商名称 + 模型名称 */
    const slashIdx = modelId.indexOf("/");
    if (slashIdx < 0) {
      throw new Error(`Invalid model format "${modelId}" — expected "provider/model"`);
    }
    const providerName = modelId.slice(0, slashIdx);
    const modelName = modelId.slice(slashIdx + 1);

    /** 3. 查找提供商配置 */
    const providers = oc.models?.providers ?? {};
    const prov = providers[providerName];
    if (!prov) {
      throw new Error(`Provider "${providerName}" not found in OpenClaw config (models.providers)`);
    }

    /** 4. 解析 API 密钥：优先从提供商配置读取，其次从 auth-profiles 读取 */
    let apiKey = prov.apiKey ?? "";
    if (!apiKey) {
      apiKey = this.loadAuthProfileKey(providerName);
    }
    if (!apiKey) {
      throw new Error(`No API key for provider "${providerName}". Set it in openclaw.json or auth-profiles.json.`);
    }

    return {
      model: modelName,
      apiType: prov.api,
      /** 去除 URL 末尾的斜杠，避免拼接时出现双斜杠 */
      baseUrl: prov.baseUrl.replace(/\/+$/, ""),
      apiKey,
      headers: prov.headers,
      maxTokens: 16384,
    };
  }

  /**
   * 从 auth-profiles.json 中加载 API 密钥
   * @param providerName - 提供商名称
   * @returns API 密钥字符串，未找到时返回空字符串
   */
  private loadAuthProfileKey(providerName: string): string {
    try {
      const profilePath = path.join(os.homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");
      if (!fs.existsSync(profilePath)) return "";
      const data = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
      const profiles: Record<string, AuthProfile> = data.profiles ?? {};
      /** 先尝试精确匹配，再尝试前缀匹配（如 "openai:gpt-4" 匹配 "openai"） */
      for (const [key, profile] of Object.entries(profiles)) {
        if (key === providerName || key.startsWith(providerName + ":")) {
          if (profile.key) return profile.key;
          if (profile.access) return profile.access;
        }
      }
    } catch {}
    return "";
  }

  // ─── OpenAI 兼容 API ───────────────────────────────────────

  /**
   * 调用 OpenAI 兼容格式的 API
   * @param prompt - 用户提示文本
   * @param system - 系统提示文本（可选）
   * @returns LLM 响应对象
   * @throws 当 API 返回错误时抛出异常
   */
  private async callOpenAI(prompt: string, system?: string): Promise<LLMResponse> {
    /** 去除 baseUrl 可能包含的 /v1 后缀，避免出现 /v1/v1 的重复路径 */
    const base = this.config.baseUrl.replace(/\/v1$/, "");
    const url = `${base}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.config.apiKey}`,
      /** 合并自定义请求头 */
      ...this.config.headers,
    };
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages: [
        /** 如果有 system prompt，添加为系统消息 */
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
      ],
    };

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await resp.json() as any;
    if (data.error) throw new Error(`OpenAI API error: ${JSON.stringify(data.error)}`);
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      usage: data.usage ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens } : undefined,
    };
  }

  // ─── Anthropic Messages API ──────────────────────────────────────

  /**
   * 调用 Anthropic Messages API
   * @param prompt - 用户提示文本
   * @param system - 系统提示文本（可选）
   * @returns LLM 响应对象
   * @throws 当 API 返回错误时抛出异常
   */
  private async callAnthropic(prompt: string, system?: string): Promise<LLMResponse> {
    /** 去除 baseUrl 可能包含的 /v1 后缀 */
    const base = this.config.baseUrl.replace(/\/v1$/, "");
    const url = `${base}/v1/messages`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": "2023-06-01",
      /** 合并自定义请求头 */
      ...this.config.headers,
    };
    const body: Record<string, any> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages: [{ role: "user", content: prompt }],
    };
    /** Anthropic API 的 system prompt 是顶层字段 */
    if (system) body.system = system;

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await resp.json() as any;
    if (data.error) throw new Error(`Anthropic API error: ${JSON.stringify(data.error)}`);
    return {
      content: data.content?.[0]?.text ?? "",
      /** Anthropic 使用 input_tokens/output_tokens 字段名 */
      usage: data.usage ? { prompt: data.usage.input_tokens, completion: data.usage.output_tokens } : undefined,
    };
  }

  // ─── Google Generative AI API ────────────────────────────────────

  /**
   * 调用 Google Generative AI API
   *
   * 注意：Google API 没有原生的 system prompt 字段，
   * 因此通过添加一条用户消息 + 模型确认消息来模拟。
   *
   * @param prompt - 用户提示文本
   * @param system - 系统提示文本（可选）
   * @returns LLM 响应对象
   * @throws 当 API 返回错误时抛出异常
   */
  private async callGoogle(prompt: string, system?: string): Promise<LLMResponse> {
    /** 去除 baseUrl 可能包含的 /v1beta 后缀 */
    const base = this.config.baseUrl.replace(/\/v1beta$/, "");
    const url = `${base}/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      /** 合并自定义请求头 */
      ...this.config.headers,
    };

    /** 构建消息列表 */
    const contents: any[] = [];
    if (system) {
      /** 通过模拟对话注入 system prompt */
      contents.push({ role: "user", parts: [{ text: system }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
    }
    contents.push({ role: "user", parts: [{ text: prompt }] });

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: this.config.maxTokens,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await resp.json() as any;
    if (data.error) throw new Error(`Google API error: ${JSON.stringify(data.error)}`);

    /** 提取 Google API 响应中的文本内容 */
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const usage = data.usageMetadata;
    return {
      content: text,
      usage: usage ? { prompt: usage.promptTokenCount ?? 0, completion: usage.candidatesTokenCount ?? 0 } : undefined,
    };
  }
}
