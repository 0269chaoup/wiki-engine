/**
 * @file search.ts
 * @description Vault 搜索命令
 * 在 vault 中搜索页面，支持按类型/域/标签/状态过滤，加权评分排序。
 */
import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { searchVault } from "../lib/search.js";
import type { SearchOptions } from "../lib/search.js";
import type { PageType } from "../lib/types.js";
import { PAGE_TYPES } from "../lib/types.js";

/**
 * 创建 search 子命令
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function searchCommand(): Command {
  return new Command("search")
    .description("Search vault pages by keyword with weighted scoring and filters")
    .argument("<query>", "search keyword or phrase")
    .option("--type <type>", "filter by page type: concept|entity|event|story|wiki|source")
    .option("--domain <domain>", "filter by knowledge domain (e.g. 'AI与大模型')")
    .option("--tag <tag>", "filter by tag")
    .option("--status <status>", "filter by status (e.g. '🌲 Evergreen')")
    .option("--level <level>", "search depth: exact (title/alias only) | fuzzy (default) | content (full-text)", "fuzzy")
    .option("--top <n>", "max results to show", "20")
    .option("--json", "output as JSON (for agent consumption)")
    .action(async (query: string, opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      // ── 扫描 vault ──
      const pages = await ctx.vault.scan();

      // ── 构建搜索选项 ──
      const searchOpts: SearchOptions = {
        type: opts.type as PageType | undefined,
        domain: opts.domain,
        tag: opts.tag,
        status: opts.status,
        level: opts.level as "exact" | "fuzzy" | "content",
        top: parseInt(opts.top, 10),
      };

      // ── 执行搜索 ──
      const results = searchVault(query, pages, searchOpts);

      // ── JSON 输出 ──
      if (opts.json) {
        const out = results.map(r => ({
          title: r.page.title,
          type: r.page.type,
          domain: r.page.domain ?? null,
          status: r.page.status ?? null,
          tags: r.page.tags,
          aliases: r.page.aliases,
          path: r.page.filePath,
          score: r.score,
          reasons: r.reasons,
        }));
        console.log(JSON.stringify(out, null, 2));
        return;
      }

      // ── 人类可读输出 ──
      if (results.length === 0) {
        console.log(`\n  ❌ No results for "${query}"`);
        return;
      }

      console.log(`\n  🔍 Found ${results.length} result(s) for "${query}"\n`);

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const info = PAGE_TYPES[r.page.type] ?? { emoji: "📄", label: r.page.type };
        const rank = `${i + 1}.`.padEnd(4);

        // 标题行：序号 + emoji + 标题 + 评分
        console.log(`  ${rank}${info.emoji}  ${r.page.title}  \x1b[90m(score: ${r.score.toFixed(1)})\x1b[0m`);

        // 详情行：路径 + 类型 + 域 + 状态
        const meta: string[] = [r.page.filePath];
        if (r.page.domain) meta.push(`📂 ${r.page.domain}`);
        if (r.page.status) meta.push(r.page.status);
        if (r.page.tags.length > 0) meta.push(r.page.tags.map(t => `#${t}`).join(" "));
        console.log(`       ${meta.join(" · ")}`);

        // 匹配原因
        if (r.reasons.length > 0) {
          console.log(`       \x1b[90m${r.reasons.join(", ")}\x1b[0m`);
        }
        console.log();
      }
    });
}
