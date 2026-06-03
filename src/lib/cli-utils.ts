/**
 * @file CLI 工具函数模块
 *
 * 提供 CLI 命令共享的工具函数，包括：
 * - CLIContext 构建（从命令行选项创建运行上下文）
 * - LLM 提供商获取（带错误检查）
 * - 格式化输出（表格行、字节大小）
 */

import { VaultReader } from "./vault.js";
import { createLLM } from "../llm/factory.js";
import type { LLMOptions } from "../llm/factory.js";
import type { LLMProvider } from "../llm/provider.js";

/**
 * CLI 运行上下文接口
 * 包含命令执行所需的所有依赖对象
 */
export interface CLIContext {
  /** Vault 读取器实例，用于访问 Obsidian vault */
  vault: VaultReader;
  /** LLM 提供商实例（可为 null，表示未配置 LLM） */
  llm: LLMProvider | null;
  /** 是否输出详细信息 */
  verbose: boolean;
}

/**
 * 从父命令选项构建 CLI 运行上下文
 *
 * 将命令行参数转换为结构化的运行上下文对象，
 * 包括 Vault 读取器和 LLM 提供商的初始化。
 *
 * @param opts - 命令行选项对象（包含 vault、llm、model 等参数）
 * @returns CLI 运行上下文对象
 */
export function buildContext(opts: any): CLIContext {
  /** 创建 Vault 读取器 */
  const vault = new VaultReader(opts.vault);
  /** 构建 LLM 配置选项 */
  const llmOpts: LLMOptions = {
    provider: opts.llm ?? "api",
    apiProvider: opts.apiProvider ?? "anthropic",
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    agentId: opts.agentId,
  };
  /** 创建 LLM 提供商实例（可能返回 null） */
  const llm = createLLM(llmOpts);
  return { vault, llm, verbose: opts.verbose ?? false };
}

/**
 * 获取 LLM 提供商实例（必需）
 *
 * 如果 LLM 提供商未配置（为 null），抛出错误。
 * 用于需要 LLM 功能的命令，确保提供商可用。
 *
 * @param ctx - CLI 运行上下文
 * @returns LLM 提供商实例
 * @throws 当 LLM 提供商不可用时抛出错误
 */
export function requireLLM(ctx: CLIContext): LLMProvider {
  if (!ctx.llm) {
    throw new Error("This command requires an LLM provider. Set ANTHROPIC_AUTH_TOKEN or use --llm agent");
  }
  return ctx.llm;
}

/**
 * 打印格式化的表格行
 *
 * 将标签和值以固定宽度对齐输出到控制台。
 *
 * @param label - 行标签文本
 * @param value - 行值（字符串或数字）
 * @param color - ANSI 颜色代码（可选，如 "32" 表示绿色）
 */
export function row(label: string, value: string | number, color?: string): void {
  /** 构建 ANSI 颜色前缀 */
  const c = color ? `\x1b[${color}m` : "";
  /** ANSI 重置码 */
  const r = "\x1b[0m";
  /** 输出格式化的行（标签固定 24 字符宽，左对齐） */
  console.log(`  ${c}${label.padEnd(24)}${r} ${value}`);
}

/**
 * 格式化字节大小为人类可读字符串
 *
 * 自动选择合适的单位（B、KB、MB）。
 *
 * @param bytes - 字节数
 * @returns 格式化后的字符串（如 "1.5KB"、"2.3MB"）
 */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
