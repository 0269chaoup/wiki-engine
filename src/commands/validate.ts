import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { validateAll } from "../lib/validate.js";

export function validateCommand(): Command {
  return new Command("validate")
    .description("Validate all knowledge files — frontmatter, structure, MOC coverage")
    .option("--dir <name>", "Limit to a specific directory (Stories|Events|Entities|Concepts)")
    .option("--errors-only", "Show only errors, not warnings", false)
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());
      const dirs = opts.dir ? [opts.dir] : undefined;

      console.log("\n🔍 Validating knowledge files...\n");
      const result = await validateAll(ctx.vault.root, { dirs });

      // Group issues by file
      const byFile = new Map<string, typeof result.issues>();
      for (const issue of result.issues) {
        if (opts.errorsOnly && issue.severity === "warning") continue;
        const existing = byFile.get(issue.file) ?? [];
        existing.push(issue);
        byFile.set(issue.file, existing);
      }

      // Print issues
      for (const [file, issues] of byFile) {
        console.log(`📄 ${file}`);
        for (const issue of issues) {
          const icon = issue.severity === "error" ? "❌" : "⚠️";
          console.log(`  ${icon} [${issue.field}] ${issue.detail}`);
        }
        console.log();
      }

      // Summary
      console.log("═══════════════════════════════");
      row("Total files", result.totalFiles, "36");
      row("Clean", result.clean, "32");
      row("Warnings", result.warnings, "33");
      row("Errors", result.errors, "31");
      console.log();

      if (result.errors > 0) process.exit(1);
    });
}
