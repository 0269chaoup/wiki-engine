import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { fixAllFrontmatter } from "../lib/fix-frontmatter.js";

export function fixFrontmatterCommand(): Command {
  return new Command("fix-frontmatter")
    .description("Batch fix missing/wrong frontmatter fields in knowledge files")
    .option("--dir <name>", "Limit to a specific directory (Stories|Events|Entities|Concepts)")
    .option("--dry-run", "Show what would be fixed without writing", false)
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());
      const dirs = opts.dir ? [opts.dir] : undefined;

      console.log(`\n🔧 ${opts.dryRun ? "Checking" : "Fixing"} frontmatter...\n`);
      const results = await fixAllFrontmatter(ctx.vault.root, { dirs, dryRun: opts.dryRun });

      if (results.length === 0) {
        console.log("✅ All files have correct frontmatter. Nothing to fix.");
        return;
      }

      let totalFixes = 0;
      for (const r of results) {
        console.log(`📄 ${r.file}`);
        for (const fix of r.fixes) {
          console.log(`  🔧 ${fix}`);
          totalFixes++;
        }
        console.log();
      }

      console.log("═══════════════════════════════");
      row("Files fixed", results.length, "36");
      row("Total fixes", totalFixes, "33");
      console.log();
    });
}
