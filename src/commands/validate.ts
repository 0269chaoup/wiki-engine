/**
 * @file validate.ts
 * @description 文档验证命令
 * 验证所有知识文件的 frontmatter 格式、结构完整性、MOC 覆盖率等，
 * 按文件分组输出问题列表，支持仅显示错误（隐藏警告）。
 */
import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { validateAll } from "../lib/validate.js";

/**
 * @description 创建 validate 子命令，验证知识文件的完整性和规范性
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function validateCommand(): Command {
  return new Command("validate")
    .description("Validate all knowledge files — frontmatter, structure, MOC coverage")
    .option("--dir <name>", "Limit to a specific directory (Stories|Events|Entities|Concepts)")
    .option("--errors-only", "Show only errors, not warnings", false)
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());
      // 如果指定了目录则限定验证范围
      const dirs = opts.dir ? [opts.dir] : undefined;

      console.log("\n🔍 Validating knowledge files...\n");
      const result = await validateAll(ctx.vault.root, { dirs });

      // 按文件路径分组问题列表
      const byFile = new Map<string, typeof result.issues>();
      for (const issue of result.issues) {
        // 如果指定了 errors-only，则跳过警告级别的问题
        if (opts.errorsOnly && issue.severity === "warning") continue;
        const existing = byFile.get(issue.file) ?? [];
        existing.push(issue);
        byFile.set(issue.file, existing);
      }

      // 逐文件输出问题详情
      for (const [file, issues] of byFile) {
        console.log(`📄 ${file}`);
        for (const issue of issues) {
          // 根据严重程度选择图标：❌ 错误，⚠️ 警告
          const icon = issue.severity === "error" ? "❌" : "⚠️";
          console.log(`  ${icon} [${issue.field}] ${issue.detail}`);
        }
        console.log();
      }

      // 输出验证统计汇总
      console.log("═══════════════════════════════");
      row("Total files", result.totalFiles, "36");
      row("Clean", result.clean, "32");
      row("Warnings", result.warnings, "33");
      row("Errors", result.errors, "31");
      console.log();

      // 如果存在错误则以非零退出码退出（便于 CI 集成）
      if (result.errors > 0) process.exit(1);
    });
}
