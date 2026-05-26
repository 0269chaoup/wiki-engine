import { Command } from "commander";
import { buildContext } from "../lib/cli-utils.js";
import { appendQuote, listQuotes } from "../lib/quote.js";

export function quoteCommand(): Command {
  const cmd = new Command("quote")
    .description("Manage 拾慧 — personal quotes collection (50-Knowledge/拾慧.md)");

  // Subcommand: add
  cmd
    .command("add")
    .description("Add a new quote to 拾慧")
    .requiredOption("-t, --text <text>", "The quote text (required)")
    .option("-s, --source <source>", "Source / who said it", "")
    .option("-d, --date <date>", "Date (YYYY-MM-DD), defaults to today")
    .option("--tags <tags>", "Comma-separated tags", "")
    .action(async (opts, subcmd) => {
      const ctx = buildContext(subcmd.parent.parent.opts());
      const result = appendQuote(ctx.vault.root, {
        text: opts.text,
        source: opts.source,
        date: opts.date ?? new Date().toISOString().slice(0, 10),
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : [],
      });

      if (result.success) {
        console.log(`✅ Quote added`);
        console.log(`   "${opts.text.slice(0, 60)}${opts.text.length > 60 ? "..." : ""}"`);
        if (opts.source) console.log(`   — ${opts.source}`);
      } else {
        console.log(`❌ ${result.detail}`);
        process.exit(1);
      }
    });

  // Subcommand: list
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

      const lastN = parseInt(opts.last, 10);
      const show = lastN > 0 ? quotes.slice(-lastN) : quotes;

      console.log(`\n📜 拾慧 — ${show.length}/${quotes.length} quotes\n`);
      for (const q of show) {
        console.log(`> "${q.text}"`);
        console.log(`> — ${q.source}${q.date ? `, ${q.date}` : ""}`);
        console.log();
      }
    });

  // Subcommand: count
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
