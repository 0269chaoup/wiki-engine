/**
 * @file LLM Provider 抽象接口定义
 *
 * 定义了 LLM（大语言模型）调用的抽象层，支持两种模式：
 * - api 模式：CLI 直接调用 LLM API（静默模式，适合自动化）
 * - pipe 模式：CLI 将 prompt 输出到 stdout，从 stdin 读取响应
 *   （设计用于 Helios：AI 代理读取 prompt，在对话中推理，
 *    将结构化结果写回 → 完整可视化）
 *
 * 所有 LLM 提供商实现（api-provider、pipe-provider、openclaw-provider）
 * 都需要实现此文件定义的 LLMProvider 接口。
 */

/**
 * LLM 响应接口
 * 表示 LLM 调用的返回结果
 */
export interface LLMResponse {
  /** 响应文本内容 */
  content: string;
  /** Token 使用量统计（可选） */
  usage?: { prompt: number; completion: number };
}

/**
 * LLM 提供商接口
 * 所有 LLM 调用实现都需要遵循此接口
 */
export interface LLMProvider {
  /** 提供商名称标识 */
  name: string;
  /**
   * 发送 prompt 并获取 LLM 响应
   * @param prompt - 用户提示文本
   * @param system - 系统提示文本（可选）
   * @returns LLM 响应对象
   */
  complete(prompt: string, system?: string): Promise<LLMResponse>;
  /**
   * 判断该提供商是否需要人工交互
   * @returns true 表示需要人工参与（如 pipe 模式）
   */
  isInteractive(): boolean;
}

/**
 * 从 LLM 响应文本中解析 JSON
 *
 * 支持多种格式：
 * 1. 直接 JSON 文本
 * 2. Markdown 代码块包裹的 JSON（```json ... ```）
 * 3. 嵌入在普通文本中的 JSON 对象/数组
 *
 * @param text - LLM 原始响应文本
 * @returns 解析后的 JSON 对象
 * @throws 当无法解析为有效 JSON 时抛出错误
 */
export function parseJSON<T = any>(text: string): T {
  /** 去除首尾空白 */
  let cleaned = text.trim();

  /** 尝试提取 Markdown 代码块中的内容 */
  const m = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) cleaned = m[1].trim();

  /** 先尝试直接解析 */
  try { return JSON.parse(cleaned); } catch {}

  /** 尝试在文本中查找 JSON 对象或数组 */
  const objMatch = cleaned.match(/[\[{][\s\S]*[\]]/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }

  /** 所有尝试均失败，抛出错误并附带部分原文 */
  throw new Error(`Failed to parse JSON from LLM response:\n${text.slice(0, 500)}`);
}
