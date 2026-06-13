#!/usr/bin/env node
/**
 * @file wiki-engine CLI 入口文件
 *
 * 本文件是 CLI 工具的主入口，负责：
 * 1. 注册所有子命令（graph、connect、dedup、ingest、scan 等）
 * 2. 定义全局选项（vault 路径、LLM 提供商、模型等）
 * 3. 启动命令行解析
 *
 * 使用 commander 库构建 CLI 框架。
 */
import { Command } from "commander";
import { graphCommand } from "./commands/graph.js";
import { connectCommand } from "./commands/connect.js";
import { dedupCommand } from "./commands/dedup.js";
import { ingestCommand } from "./commands/ingest.js";
import { scanCommand } from "./commands/scan.js";
import { mocSyncCommand } from "./commands/moc-sync.js";
import { quoteCommand } from "./commands/quote.js";
import { validateCommand } from "./commands/validate.js";
import { createCommand } from "./commands/create.js";
import { fixFrontmatterCommand } from "./commands/fix-frontmatter.js";
import { archiveCommand } from "./commands/archive.js";
import { searchCommand } from "./commands/search.js";
import { checkLinksCommand } from "./commands/check-links.js";
import { backlinkScanCommand } from "./commands/backlink-scan.js";

/** 创建 CLI 程序实例 */
const program = new Command();

/** 配置 CLI 程序的基本信息和全局选项 */
program
  .name("wiki-engine")
  .description("Obsidian vault analysis engine — graph, dedup, connections, ingest")
  .version("1.0.0")
  /** vault 根目录路径，默认使用环境变量 OBSIDIAN_VAULT 或当前工作目录 */
  .option("--vault <path>", "vault root directory", process.env.OBSIDIAN_VAULT ?? process.cwd())
  /** LLM 提供商选择：agent（本地代理）、api（直接 API 调用）、openclaw（OpenClaw 平台） */
  .option("--llm <provider>", "LLM provider: agent | api | openclaw", "agent")
  /** API 提供商名称，默认 Anthropic */
  .option("--api-provider <name>", "API provider: anthropic | openai", "anthropic")
  /** LLM 模型名称 */
  .option("--model <name>", "LLM model name", "claude-sonnet-4-6")
  /** API 密钥（也可通过环境变量设置） */
  .option("--api-key <key>", "API key (or set ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY)")
  /** 自定义 API 基础 URL（用于代理） */
  .option("--base-url <url>", "Custom API base URL (for proxies)")
  /** OpenClaw 代理 ID */
  .option("--agent-id <id>", "OpenClaw agent ID (default: main)")
  /** 是否输出详细信息 */
  .option("--verbose", "verbose output", false);

/** 注册所有子命令 */
program.addCommand(graphCommand());      /** 知识图谱构建与分析 */
program.addCommand(connectCommand());    /** 文档关联发现 */
program.addCommand(dedupCommand());      /** 三阶段去重 */
program.addCommand(ingestCommand());     /** 内容摄入管线 */
program.addCommand(scanCommand());       /** Vault 扫描统计 */
program.addCommand(mocSyncCommand());    /** MOC 索引同步 */
program.addCommand(quoteCommand());      /** 语录管理 */
program.addCommand(validateCommand());   /** 内容验证 */
program.addCommand(createCommand());     /** 创建新页面 */
program.addCommand(fixFrontmatterCommand()); /** 修复 frontmatter */
program.addCommand(archiveCommand());    /** Inbox→Permanent 归档 */
program.addCommand(searchCommand());     /** Vault 搜索 */
program.addCommand(checkLinksCommand()); /** MOC 双链检查 */
program.addCommand(backlinkScanCommand()); /** 双链补全扫描 */

/** 启动命令行参数解析 */
program.parse();
