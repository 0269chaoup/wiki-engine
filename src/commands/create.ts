import { Command } from "commander";
import { buildContext } from "../lib/cli-utils.js";
import { createKnowledgeFile } from "../lib/create.js";

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
      const ctx = buildContext(cmd.parent.opts());

      const result = createKnowledgeFile(ctx.vault.root, {
        type: opts.type,
        domain: opts.domain,
        title: opts.name,
        tags: opts.tags?.split(",").map((t: string) => t.trim()),
        source: opts.source,
        aliases: opts.aliases?.split(",").map((a: string) => a.trim()),
        status: opts.status,
      });

      if (result.success) {
        console.log(`✅ ${result.detail}`);
      } else {
        console.log(`❌ ${result.detail}`);
        process.exit(1);
      }
    });
}
