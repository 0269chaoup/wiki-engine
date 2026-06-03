/**
 * @file 管道模式 LLM 提供商实现（Helios 模式）
 *
 * 此提供商不直接调用 API，而是通过标准输入/输出管道与外部 AI 代理通信：
 * 1. 将 prompt 以 JSON 格式输出到 stdout
 * 2. 从 stdin 等待 JSON 格式的响应
 *
 * 设计用于 Helios（AI 代理）场景：
 * - Helios 将此 CLI 作为子进程启动
 * - 从 stdout 读取 prompt
 * - 在对话中推理（在聊天中可见 = 可视化！）
 * - 将结果写回 stdin
 * - CLI 继续执行
 *
 * 通信协议（JSON lines 格式）：
 * → stdout: {"type":"prompt","id":"...","prompt":"...","system":"..."}
 * ← stdin:  {"type":"response","id":"...","content":"..."}
 */

import * as readline from "readline";
import type { LLMProvider, LLMResponse } from "./provider.js";

/**
 * 管道模式 LLM 提供商类
 *
 * 通过 stdin/stdout 管道与外部 AI 代理（如 Helios）通信。
 * 支持并发请求，通过唯一 ID 匹配请求和响应。
 */
export class PipeProvider implements LLMProvider {
  /** 提供商标识名称 */
  name = "pipe";
  /** 待处理的请求映射表（key 为请求 ID，value 为 resolve 回调） */
  private pendingResolves = new Map<string, (value: string) => void>();
  /** readline 接口实例，用于从 stdin 逐行读取 */
  private rl: readline.Interface;
  /** prompt 请求计数器，用于生成唯一 ID */
  private promptCounter = 0;

  /**
   * 构造函数
   * 初始化 stdin 读取接口并设置响应监听器
   */
  constructor() {
    /** 创建 readline 接口，从 stdin 读取（非终端模式） */
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });
    /** 监听每一行输入，解析为 JSON 响应 */
    this.rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        /** 匹配响应类型和请求 ID，触发对应的等待回调 */
        if (msg.type === "response" && msg.id && this.pendingResolves.has(msg.id)) {
          this.pendingResolves.get(msg.id)!(msg.content);
          this.pendingResolves.delete(msg.id);
        }
      } catch {} /** 忽略非 JSON 格式的输入 */
    });
  }

  /** 交互模式，返回 true（需要外部 AI 代理参与） */
  isInteractive() { return true; }

  /**
   * 发送 prompt 并等待响应
   *
   * 流程：
   * 1. 生成唯一请求 ID
   * 2. 将 prompt 以 JSON 格式写入 stdout
   * 3. 等待 stdin 收到匹配的响应（5 分钟超时）
   *
   * @param prompt - 用户提示文本
   * @param system - 系统提示文本（可选）
   * @returns LLM 响应对象
   * @throws 当等待响应超时时抛出错误
   */
  async complete(prompt: string, system?: string): Promise<LLMResponse> {
    /** 生成递增的唯一请求 ID */
    const id = `p${++this.promptCounter}`;

    /** 将 prompt 以 JSON 行格式输出到 stdout */
    const msg = JSON.stringify({ type: "prompt", id, prompt, system });
    process.stdout.write(msg + "\n");

    /** 等待响应 */
    return new Promise((resolve, reject) => {
      /** 设置 5 分钟超时定时器 */
      const timer = setTimeout(() => {
        this.pendingResolves.delete(id);
        reject(new Error(`Pipe timeout waiting for response (id=${id}). Is Helios listening?`));
      }, 300_000); // 5 分钟超时

      /** 注册待处理请求 */
      this.pendingResolves.set(id, (content) => {
        clearTimeout(timer);
        resolve({ content });
      });
    });
  }

  /**
   * 关闭管道连接
   * 清理 readline 接口，释放 stdin 资源
   */
  close() {
    this.rl.close();
  }
}
