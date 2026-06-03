/**
 * @file LLM Provider 工厂模块
 *
 * 根据 CLI 选项创建对应的 LLM 提供商实例。
 * 支持三种模式：
 * - agent（PipeProvider）：通过管道与 Helios AI 代理通信
 * - api（APIProvider）：直接调用 LLM API
 * - openclaw（OpenClawProvider）：读取 OpenClaw 配置并调用 LLM
 */

import type { LLMProvider } from "./provider.js";
import { APIProvider } from "./api-provider.js";
import { PipeProvider } from "./pipe-provider.js";
import { OpenClawProvider } from "./openclaw-provider.js";

/**
 * LLM 配置选项接口
 * 定义了创建 LLM 提供商所需的全部配置参数
 */
export interface LLMOptions {
  /** 提供商模式：api（直接调用）、agent（管道通信）、openclaw（OpenClaw 平台） */
  provider: "api" | "agent" | "openclaw";
  /** API 提供商名称（api 模式下使用）：anthropic 或 openai */
  apiProvider?: "anthropic" | "openai";
  /** LLM 模型名称 */
  model?: string;
  /** API 密钥 */
  apiKey?: string;
  /** 自定义 API 基础 URL（用于代理或私有部署） */
  baseUrl?: string;
  /** OpenClaw 代理 ID（openclaw 模式下使用） */
  agentId?: string;
}

/**
 * 根据 CLI 选项创建 LLM 提供商实例
 *
 * 映射关系：
 * - --llm agent    → PipeProvider：Helios 读取 prompt，在对话中推理，写回结果
 * - --llm api      → APIProvider：静默模式，直接调用 API
 * - --llm openclaw → OpenClawProvider：读取 OpenClaw 配置，直接调用 LLM
 *
 * 如果提供商创建失败（如缺少 API key），返回 null ——
 * 不需要 LLM 的命令仍可正常运行。
 *
 * @param opts - LLM 配置选项
 * @returns LLM 提供商实例，创建失败时返回 null
 */
export function createLLM(opts: LLMOptions): LLMProvider | null {
  /** agent 模式：使用管道通信 */
  if (opts.provider === "agent") {
    return new PipeProvider();
  }
  /** openclaw 模式：读取 OpenClaw 配置文件 */
  if (opts.provider === "openclaw") {
    try {
      return new OpenClawProvider({
        model: opts.model,
        agentId: opts.agentId,
      });
    } catch (e) {
      console.error(`❌ OpenClaw provider failed: ${(e as Error).message}`);
      return null;
    }
  }
  /** api 模式：直接调用 LLM API */
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
