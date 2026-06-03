/**
 * @file fix-frontmatter.ts
 * @description 修复 frontmatter 格式命令
 * 批量扫描并修复知识文件中缺失或错误的 frontmatter 字段，
 * 支持限定目录范围和干运行预览模式。
 */
import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { fixAllFrontmatter } from "../lib/fix-frontmatter.js";

/**
 * @description 创建 fix-frontmatter 子命令，批量修复 frontmatter 字段问题
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function fixFrontmatterCommand(): Command {
  return new Command("fix-frontmatter")
    .description("Batch fix missing/wrong frontmatter fields in knowledge files")
    .option("--dir <name>", "Limit to a specific directory (Stories|Events|Entities|Concepts)")
    .option("--dry-run", "Show what would be fixed without writing", false)
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());
      // 如果指定了目录则限定范围，否则扫描所有目录
      const dirs = opts.dir ? [opts.dir] : undefined;

      // 根据是否干运行显示不同提示
      console.log(`\n🔧 ${opts.dryRun ? "Checking" : "Fixing"} frontmatter...\n`);
      const results = await fixAllFrontmatter(ctx.vault.root, { dirs, dryRun: opts.dryRun });

      // 所有文件的 frontmatter 均正确
      if (results.length === 0) {
        console.log("✅ All files have correct frontmatter. Nothing to fix.");
        return;
      }

      // 逐文件输出修复详情
      let totalFixes = 0;
      for (const r of results) {
        console.log(`📄 ${r.file}`);
        for (const fix of r.fixes) {
          console.log(`  🔧 ${fix}`);
          totalFixes++;
        }
        console.log();
      }

      // 输出修复统计汇总
      console.log("═══════════════════════════════");
      row("Files fixed", results.length, "36");
      row("Total fixes", totalFixes, "33");
      console.log();
    });
}
