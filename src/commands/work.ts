/**
 * @file work.ts
 * @description 工作任务管理命令
 * 管理 30-Projects/Work 目录下的工作/项目笔记，提供以下子命令：
 * - create: 创建新工作笔记
 * - validate: 验证工作文件规范
 * - index: 生成/更新项目索引
 * - archive: 归档项目
 * - task: 任务管理（[!todo] 格式）
 * - fix: 修复 frontmatter
 * - normalize: 全面规范化
 * - report: 项目状态报告
 */
import { Command } from "commander";
import { buildContext, row } from "../lib/cli-utils.js";
import {
  createWorkFile,
  validateWork,
  generateIndex,
  archiveProject,
  generateReport,
  fixWorkFrontmatter,
  normalizeWorkFiles,
  createTaskNote,
} from "../lib/work.js";

/**
 * @description 创建 work 命令组，管理 30-Projects/Work 下的工作笔记
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function workCommand(): Command {
  const work = new Command("work")
    .description("Manage work/project notes in 30-Projects/Work");

  // ── work create —— 创建新工作笔记 ──────────────────────────────────
  work
    .command("create")
    .description("Create a new work note with proper frontmatter")
    .argument("<project>", "Project name (directory under 30-Projects/Work)")
    .argument("<title>", "Document title")
    .option("-t, --type <type>", "Document type: Task | TechNote", "Task")
    .option("--status <status>", "Status: 🌱 Planned | 🌿 Active | 🚧 Blocked | 🍂 Completed", "🌱 Planned")
    .action(async (project, title, opts) => {
      const ctx = buildContext(work.parent!.opts());

      const result = createWorkFile(ctx.vault.root, {
        project,
        title,
        type: opts.type,
        status: opts.status,
      });

      if (result.created) {
        console.log(`\n✅ Created: ${result.filePath}`);
      } else {
        console.log(`\n⚠️ Already exists: ${result.filePath}`);
      }
    });

  // ── work validate —— 验证工作文件 ──────────────────────────────────
  work
    .command("validate")
    .description("Validate work files — frontmatter, type, status")
    .option("-p, --project <name>", "Limit to a specific project")
    .option("--errors-only", "Show only errors, not warnings", false)
    .action(async (opts) => {
      const ctx = buildContext(work.parent!.opts());

      console.log("\n🔍 Validating work files...\n");
      const result = await validateWork(ctx.vault.root, {
        project: opts.project,
      });

      if (result.issues.length === 0) {
        console.log(`✅ All ${result.totalFiles} files are valid.`);
        return;
      }

      // 按文件分组显示问题
      const byFile = new Map<string, typeof result.issues>();
      for (const issue of result.issues) {
        if (opts.errorsOnly && issue.severity === "warning") continue;
        const existing = byFile.get(issue.file) ?? [];
        existing.push(issue);
        byFile.set(issue.file, existing);
      }

      for (const [file, issues] of byFile) {
        console.log(`📄 ${file}`);
        for (const issue of issues) {
          const icon = issue.severity === "error" ? "❌" : "⚠️";
          console.log(`   ${icon} [${issue.field}] ${issue.detail}`);
        }
        console.log();
      }

      // 输出汇总统计
      console.log("═".repeat(50));
      console.log(
        `Total: ${result.totalFiles} | Clean: ${result.clean} | Errors: ${result.errors} | Warnings: ${result.warnings}`
      );
    });

  // ── work index —— 生成/更新项目索引 ─────────────────────────────────
  work
    .command("index")
    .description("Generate/update INDEX.md for each project")
    .option("-p, --project <name>", "Limit to a specific project")
    .action(async (opts) => {
      const ctx = buildContext(work.parent!.opts());

      console.log("\n📋 Generating project indexes...\n");
      const results = await generateIndex(ctx.vault.root, {
        project: opts.project,
      });

      for (const r of results) {
        console.log(`  📁 ${r.project}: ${r.fileCount} files → ${r.filePath}`);
      }
      console.log(`\n✅ Updated ${results.length} project index(es).`);
    });

  // ── work archive —— 归档项目 ────────────────────────────────────────
  work
    .command("archive")
    .description("Archive a project (compact TechNotes into post-mortem)")
    .argument("<project>", "Project name to archive")
    .option("--compact", "Compact TechNotes into a post-mortem report", false)
    .option("--dry-run", "Show what would be archived without writing", false)
    .action(async (project, opts) => {
      const ctx = buildContext(work.parent!.opts());

      // 干运行模式：只预览将要归档的文件
      if (opts.dryRun) {
        const report = await generateReport(ctx.vault.root);
        const proj = report.projects.find((p) => p.name === project);
        if (!proj) {
          console.log(`\n❌ Project not found: ${project}`);
          return;
        }
        // 过滤出未归档的文件
        const nonArchived = proj.files.filter(
          (f) => f.status !== "🗃️ Archived"
        );
        console.log(
          `\n📋 Would archive ${nonArchived.length} files in ${project}:`
        );
        for (const f of nonArchived) {
          console.log(`  📄 ${f.title} (${f.status || "no status"})`);
        }
        // 如果启用 compact 模式，显示将压缩的 TechNote 数量
        if (opts.compact) {
          const techNotes = proj.files.filter((f) => f.type === "TechNote");
          console.log(`\n📦 Would compact ${techNotes.length} TechNotes into post-mortem`);
        }
        return;
      }

      console.log(`\n🗄️ Archiving project: ${project}...\n`);
      const result = await archiveProject(ctx.vault.root, project, {
        compact: opts.compact,
      });
      console.log(`✅ Archived: ${result.archived} | Skipped: ${result.skipped}`);
      if (result.compacted > 0) {
        console.log(`📦 Compacted: ${result.compacted} TechNotes → ${result.postMortemPath}`);
      }
    });

  // ── work task —— 任务管理子命令组 ──────────────────────────────────
  const task = work.command("task").description("Task management with [!todo] callout format");

  // work task create —— 创建任务笔记
  task
    .command("create")
    .description("Create a task note with [!todo] callout template")
    .argument("<project>", "Project name")
    .argument("<title>", "Task note title")
    // --group 支持多次指定，收集到数组中
    .option("--group <name>", "Task group name (can repeat)", (val: string, prev: string[]) => [...prev, val], [] as string[])
    .action(async (project, title, opts) => {
      const ctx = buildContext(work.parent!.opts());

      // 构建任务组结构
      const groups = opts.group.length > 0
        ? opts.group.map((name: string) => ({
            name,
            categories: [{ name: "待办", tasks: [{ text: "待填写", done: false }] }],
          }))
        : [
            {
              name: title,
              categories: [{ name: "待办", tasks: [{ text: "待填写", done: false }] }],
            },
          ];

      const result = createTaskNote(ctx.vault.root, { project, title, groups });
      if (result.created) {
        console.log(`\n✅ Created task note: ${result.filePath}`);
      } else {
        console.log(`\n⚠️ Already exists: ${result.filePath}`);
      }
    });

  // work task template —— 显示任务格式模板
  task
    .command("template")
    .description("Show the [!todo] task format template")
    .action(() => {
      console.log(`
任务格式模板：
─────────────

> [!todo] 任务组名
> - **子任务类别**
>   - [ ] 待办任务
>   - [x] 已完成任务
> - **另一类别**
>   - [ ] 待办任务

使用方式：
  wiki-engine work task create <项目> <标题> --group "任务组名"
`);
    });

  // ── work fix —— 修复工作文件的 frontmatter ──────────────────────────
  work
    .command("fix")
    .description("Fix missing/wrong frontmatter in work files (auto-migrate old status)")
    .option("-p, --project <name>", "Limit to a specific project")
    .option("--dry-run", "Show what would be fixed without writing", false)
    .action(async (opts) => {
      const ctx = buildContext(work.parent!.opts());

      console.log(`\n🔧 ${opts.dryRun ? "Checking" : "Fixing"} work frontmatter...\n`);
      const results = await fixWorkFrontmatter(ctx.vault.root, {
        project: opts.project,
        dryRun: opts.dryRun,
      });

      if (results.length === 0) {
        console.log("✅ All work files have correct frontmatter.");
        return;
      }

      // 逐文件输出修复详情
      let totalFixes = 0;
      for (const r of results) {
        console.log(`📄 ${r.file}`);
        for (const fix of r.fixes) {
          console.log(`   🔧 ${fix}`);
          totalFixes++;
        }
        console.log();
      }

      console.log("═".repeat(50));
      console.log(`Files fixed: ${results.length} | Total fixes: ${totalFixes}`);
    });

  // ── work normalize —— 全面规范化 ────────────────────────────────────
  // 修复类型（→ Task/TechNote）、移除 Knowledge 专属字段、统一 created 格式、移动孤立文件
  work
    .command("normalize")
    .description(
      "Full normalization: fix types (→ Task/TechNote), strip Knowledge fields, " +
      "unify created format, move orphan files to project dirs"
    )
    .option("-p, --project <name>", "Limit to a specific project")
    .option("--dry-run", "Show what would change without writing", false)
    .action(async (opts) => {
      const ctx = buildContext(work.parent!.opts());

      console.log(
        `\n🔄 ${opts.dryRun ? "Previewing" : "Running"} full normalization...\n`
      );
      const results = await normalizeWorkFiles(ctx.vault.root, {
        project: opts.project,
        dryRun: opts.dryRun,
      });

      if (results.length === 0) {
        console.log("✅ All work files are already normalized.");
        return;
      }

      // 逐文件输出规范化变更
      let totalChanges = 0;
      for (const r of results) {
        console.log(`📄 ${r.file}`);
        for (const change of r.changes) {
          console.log(`   🔧 ${change}`);
          totalChanges++;
        }
        if (r.moved) {
          console.log(`   📁 → ${r.moved}`);
        }
        console.log();
      }

      console.log("═".repeat(50));
      console.log(
        `Files changed: ${results.length} | Total changes: ${totalChanges}`
      );
      if (opts.dryRun) {
        console.log("\n⚠️  Dry run — no files were modified. Run without --dry-run to apply.");
      }
    });

  // ── work report —— 项目状态报告 ────────────────────────────────────
  work
    .command("report")
    .description("Project status report — overview of all projects")
    .action(async () => {
      const ctx = buildContext(work.parent!.opts());

      console.log("\n📊 Work Projects Report\n");
      const report = await generateReport(ctx.vault.root);

      // 遍历每个项目，显示状态分布
      for (const proj of report.projects) {
        const statusLine = Object.entries(proj.statusBreakdown)
          .map(([s, c]) => `${s}:${c}`)
          .join(" ");
        console.log(`📁 ${proj.name} (${proj.fileCount} files)`);
        console.log(`   ${statusLine}`);

        // 显示被阻塞的任务
        if (proj.blockedItems.length > 0) {
          console.log(`   ⛔ Blocked:`);
          for (const item of proj.blockedItems) {
            console.log(`      - ${item.file}: ${item.blocked_by}`);
          }
        }
        console.log();
      }

      // 显示不属于任何项目的孤立文件
      if (report.orphanFiles.length > 0) {
        console.log(`📎 Root-level files (${report.orphanFiles.length}):`);
        for (const f of report.orphanFiles) {
          console.log(`  ${f.title} [${f.type || "no type"}]`);
        }
        console.log();
      }

      // 输出总览
      console.log("═".repeat(50));
      console.log(
        `Total: ${report.totalFiles} files across ${report.totalProjects} projects`
      );
    });

  return work;
}
