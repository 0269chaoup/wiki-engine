/**
 * @file create.ts
 * @description 创建新文档命令
 * 使用预定义的模板结构创建知识库文档（Story/Event/Entity/Concept），
 * 自动生成符合规范的 frontmatter 元数据。
 */
import { Command } from "commander";
import { buildContext } from "../lib/cli-utils.js";
import { createKnowledgeFile } from "../lib/create.js";

/**
 * @description 创建 create 子命令，用于生成带模板结构的新知识文件
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function createCommand(): Command {
  return new Command("create")
    .description("Create a new knowledge file with proper template structure")
    .requiredOption("-t, --type <type>", "Document type: Story | Event | Entity | Concept")
    .requiredOption("-d, --domain <domain>", "Domain: AI与大模型 | 项目管理 | 软件开发 | ...")
    .requiredOption("-n, --name <title>", "Document title / name")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--source <source>", "Source reference (e.g., [[article-name]])")
    .option("--aliases <aliases>", "Comma-separated aliases")
    .option("--status <status>", "Status: 🌱 Seed | 🌿 Growing | 🌲 Evergreen")
    .action(async (opts, cmd) => {
      // 构建 CLI 上下文
      const ctx = buildContext(cmd.parent.opts());

      // 调用创建函数，将逗号分隔的标签和别名拆分为数组
      const result = createKnowledgeFile(ctx.vault.root, {
        type: opts.type,
        domain: opts.domain,
        title: opts.name,
        tags: opts.tags?.split(",").map((t: string) => t.trim()),
        source: opts.source,
        aliases: opts.aliases?.split(",").map((a: string) => a.trim()),
        status: opts.status,
      });

      // 输出创建结果
      if (result.success) {
        console.log(`✅ ${result.detail}`);
      } else {
        console.log(`❌ ${result.detail}`);
        process.exit(1);
      }
    });
}
