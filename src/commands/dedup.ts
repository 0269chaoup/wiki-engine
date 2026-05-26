import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { dedupScan } from "../lib/dedup.js";

export function dedupCommand(): Command {
  return new Command("dedup")
    .description("Scan vault for duplicate/similar pages")
    .option("--threshold <n>", "similarity threshold (0-1)", "0.6")
    .option("--json", "output as JSON")
    .option("--fix", "auto-fix high-confidence duplicates (rename/merge)")
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      console.log("\n🔎 Scanning vault for duplicates...");
      const pages = await ctx.vault.scan();
      console.log(`   Found ${pages.length} pages\n`);

      // Scan each page against all others
      const allMatches = dedupScan(pages, pages);

      // Deduplicate the dedup results (same pair A↔B)
      const seen = new Set<string>();
      const unique = allMatches.filter(m => {
        const key = [m.newTitle, m.existingTitle].sort().join("|||");
        if (seen.has(key)) return false;
        seen.add(key);
        return m.newTitle !== m.existingTitle;
      });

      const threshold = parseFloat(opts.threshold);
      const filtered = unique.filter(m => m.score >= threshold);

      if (opts.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      if (filtered.length === 0) {
        console.log("✅ No duplicates found!\n");
        return;
      }

      console.log(`═══ Potential Duplicates (${filtered.length}) ═══\n`);

      const skip = filtered.filter(m => m.action === "skip");
      const review = filtered.filter(m => m.action === "review");

      if (skip.length > 0) {
        console.log(`  ⛔ High-confidence duplicates (${skip.length}):`);
        for (const m of skip) {
          row(m.newTitle, `≈ ${m.existingTitle} (${(m.score * 100).toFixed(0)}%)`, "31");
          console.log(`     Reasons: ${m.reasons.join(", ")}`);
        }
        console.log();
      }

      if (review.length > 0) {
        console.log(`  ⚠️  Needs review (${review.length}):`);
        for (const m of review) {
          row(m.newTitle, `≈ ${m.existingTitle} (${(m.score * 100).toFixed(0)}%)`, "33");
          console.log(`     Reasons: ${m.reasons.join(", ")}`);
        }
        console.log();
      }
    });
}
