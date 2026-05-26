import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { PAGE_TYPES } from "../lib/types.js";

export function scanCommand(): Command {
  return new Command("scan")
    .description("Quick vault scan — page count, type distribution, tag cloud")
    .option("--tags", "show tag distribution")
    .option("--recent <n>", "show N most recently modified files", "10")
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      console.log("\n🔍 Scanning vault...");
      const pages = await ctx.vault.scan();

      // Type distribution
      const typeCount = new Map<string, number>();
      for (const p of pages) {
        typeCount.set(p.type, (typeCount.get(p.type) ?? 0) + 1);
      }

      console.log("\n═══ Page Types ═══");
      for (const [type, count] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) {
        const info = PAGE_TYPES[type as keyof typeof PAGE_TYPES];
        const emoji = info?.emoji ?? "📄";
        const label = info?.label ?? type;
        const bar = "█".repeat(Math.round(count / pages.length * 40));
        row(`${emoji} ${label} (${type})`, `${count} ${bar}`, "36");
      }
      console.log();

      // Tag cloud
      if (opts.tags) {
        const tagCount = new Map<string, number>();
        for (const p of pages) {
          for (const t of p.tags) {
            tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
          }
        }
        const sorted = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
        console.log("═══ Top Tags ═══");
        for (const [tag, count] of sorted) {
          row(`#${tag}`, count, "35");
        }
        console.log();
      }

      // Total
      row("Total pages", pages.length, "36");
      const totalLinks = pages.reduce((sum, p) => sum + p.wikilinks.length, 0);
      row("Total wikilinks", totalLinks, "33");
      row("Avg links/page", (totalLinks / pages.length).toFixed(1), "33");
      console.log();
    });
}
