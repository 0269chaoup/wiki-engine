/**
 * @file quote.ts
 * @description 语录管理命令
 * 管理「拾慧」个人语录集（50-Knowledge/拾慧.md），
 * 提供添加、列出、统计子命令。
 */
import { Command } from "commander";
import { buildContext } from "../lib/cli-utils.js";
import { appendQuote, listQuotes } from "../lib/quote.js";

/**
 * @description 创建 quote 子命令组，管理个人语录
 * 包含三个子命令：add（添加）、list（列出）、count（统计）
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function quoteCommand(): Command {
  const cmd = new Command("quote")
    .description("Manage 拾慧 — personal quotes collection (50-Knowledge/拾慧.md)");

  // ─── 子命令：add —— 添加新语录 ───
  cmd
    .command("add")
    .description("Add a new quote to 拾慧")
    .requiredOption("-t, --text <text>", "The quote text (required)")
    .option("-s, --source <source>", "Source / who said it", "")
    .option("-d, --date <date>", "Date (YYYY-MM-DD), defaults to today")
    .option("--tags <tags>", "Comma-separated tags", "")
    .action(async (opts, subcmd) => {
      // 注意：嵌套子命令需要向上两层获取全局选项
      const ctx = buildContext(subcmd.parent.parent.opts());
      const result = appendQuote(ctx.vault.root, {
        text: opts.text,
        source: opts.source,
        // 默认使用当天日期
        date: opts.date ?? new Date().toISOString().slice(0, 10),
        // 将逗号分隔的标签拆分为数组
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : [],
      });

      if (result.success) {
        console.log(`✅ Quote added`);
        // 显示语录预览（截取前 60 个字符）
        console.log(`   "${opts.text.slice(0, 60)}${opts.text.length > 60 ? "..." : ""}"`);
        if (opts.source) console.log(`   — ${opts.source}`);
      } else {
        console.log(`❌ ${result.detail}`);
        process.exit(1);
      }
    });

  // ─── 子命令：list —— 列出所有语录 ───
  cmd
    .command("list")
    .description("List all quotes in 拾慧")
    .option("-n, --last <n>", "Show only the last N quotes", "0")
    .action(async (opts, subcmd) => {
      const ctx = buildContext(subcmd.parent.parent.opts());
      const quotes = listQuotes(ctx.vault.root);

      if (quotes.length === 0) {
        console.log("📭 No quotes found.");
        return;
      }

      // 如果指定了 --last N，则只显示最后 N 条
      const lastN = parseInt(opts.last, 10);
      const show = lastN > 0 ? quotes.slice(-lastN) : quotes;

      console.log(`\n📜 拾慧 — ${show.length}/${quotes.length} quotes\n`);
      for (const q of show) {
        console.log(`> "${q.text}"`);
        console.log(`> — ${q.source}${q.date ? `, ${q.date}` : ""}`);
        console.log();
      }
    });

  // ─── 子命令：count —— 显示语录总数 ───
  cmd
    .command("count")
    .description("Show total quote count")
    .action(async (_opts, subcmd) => {
      const ctx = buildContext(subcmd.parent.parent.opts());
      const quotes = listQuotes(ctx.vault.root);
      console.log(`📜 Total quotes: ${quotes.length}`);
    });

  return cmd;
}
