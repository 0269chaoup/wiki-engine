/**
 * @file check-links.ts
 * @description MOC 双链检查命令
 * 委托给 @hermes/vault-utils 的 checkLinks 实现。
 */
import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import { checkLinks } from "@hermes/vault-utils";

/**
 * @description 创建 check-links 子命令
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function checkLinksCommand(): Command {
  return new Command("check-links")
    .description("Check MOC files for broken wikilinks — detect missing docs, prefix issues, name mismatches")
    .option("--fix", "Auto-fix links with suggestions (remove prefixes, fix name mismatches)", false)
    .option("--dir <name>", "Limit to a specific directory (e.g. 50-Knowledge, 30-Projects)")
    .option("--json", "Output as JSON", false)
    .action(async (opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      console.log("\n🔗 Checking MOC links...\n");
      const result = await checkLinks(ctx.vault.root, {
        dirs: opts.dir ? [opts.dir] : undefined,
        fix: opts.fix,
      });

      // JSON 输出模式
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.brokenLinks.length > 0 ? 1 : 0);
      }

      // 人类可读输出
      if (result.brokenLinks.length === 0) {
        console.log("✅ All links are valid!\n");
      } else {
        // 按源文件分组
        const byFile = new Map<string, typeof result.brokenLinks>();
        for (const link of result.brokenLinks) {
          const existing = byFile.get(link.sourceFile) ?? [];
          existing.push(link);
          byFile.set(link.sourceFile, existing);
        }

        for (const [file, links] of byFile) {
          const shortPath = file.replace(ctx.vault.root + "/", "");
          console.log(`📄 ${shortPath}`);
          for (const link of links) {
            const icon = link.issue === "missing" ? "❌" : link.issue === "prefix" ? "🔗" : "⚠️";
            const suggestion = link.suggestion ? ` → ${link.suggestion}` : "";
            console.log(`  ${icon} L${link.line}: [[${link.link}]]${suggestion}`);
          }
          console.log();
        }
      }

      // 统计汇总
      console.log("═══════════════════════════════");
      row("Files scanned", result.totalFiles, "36");
      row("Total links", result.totalLinks, "36");
      row("Broken links", result.brokenLinks.length, result.brokenLinks.length > 0 ? "31" : "32");
      if (opts.fix) {
        row("Fixed", result.fixedCount, "32");
      }
      console.log();

      // 退出码
      if (result.brokenLinks.length > 0 && !opts.fix) process.exit(1);
    });
}
