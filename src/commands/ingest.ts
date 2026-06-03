/**
 * @file ingest.ts
 * @description 内容摄入管线入口命令
 * 将外部内容（文件/URL）摄入到知识库的多阶段管线：
 * Stage 1: 内容提取（实体/事件/概念）
 * Stage 2: Vault 对齐（检测已有文档，避免重复）
 * Stage 3: 页面生成（LLM 生成 wiki 页面）
 * Stage 4: 分发到 Inbox（待学习确认）
 * 支持 URL 网页剪藏、文件摄入、断点续传（finalize）等模式。
 */
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { buildContext, requireLLM, row } from "../lib/cli-utils.js";
import { ingestText, buildAnalyzePrompt } from "../lib/ingest.js";
import { dedupScan } from "../lib/dedup.js";
import { clipWebPage } from "../lib/clip.js";
import { alignToVault } from "../lib/stage2-align.js";
import { dispatchToInbox } from "../lib/stage4-dispatch.js";
import { generateBatchId } from "../lib/manifest.js";
import type { WikiPage, SourceDocument, ExtractedEntity, ExtractedEvent } from "../lib/types.js";

/**
 * @description 创建 ingest 子命令，作为内容摄入的主入口
 * @returns {Command} 配置好的 Commander 命令实例
 */
export function ingestCommand(): Command {
  const cmd = new Command("ingest")
    .description("Ingest content → Inbox (default) or Permanent (--no-inbox)")
    .argument("[path]", "file or directory to ingest (omit when using --url)")
    .option("--dry-run", "show what would be created without writing")
    .option("--no-story", "skip story generation")
    .option("--no-pages", "skip wiki page generation (analyze only)")
    .option("--out <dir>", "output directory (legacy mode with --no-inbox)", "wiki")
    .option("--create-stubs", "create stub pages for all mentioned entities")
    // ─── Inbox-first 模式选项 ───
    .option("--no-inbox", "skip Inbox, write directly to --out (legacy behavior)")
    .option("--batch-id <id>", "custom batch ID (default: auto-generated)")
    .option("--stop-after <stage>", "pause after stage: extraction | alignment")
    .option("--finalize <json>", "resume from extraction result (JSON file or stdin)")
    // ─── URL → Sources 模式选项 ───
    .option("--url <url>", "clip a web page from this URL")
    .option("--to-sources", "save clipped content to 50-Knowledge/Sources/")
    .option("--selector <css>", "CSS selector for content extraction (override auto-detect)")
    .option("--title <title>", "override title for the clipped article")
    .action(async (targetPath: string | undefined, opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      // ─── URL → Sources 模式：将网页剪藏到 Sources 目录 ───
      if (opts.url || opts.toSources) {
        return handleClipToSources(opts, ctx);
      }

      // ─── Finalize 模式：从提取结果断点续传 ───
      if (opts.finalize) {
        return handleFinalize(opts, ctx);
      }

      // ─── 文件摄入模式 ───
      if (!targetPath) {
        console.error("❌ Please provide a <path> or use --url <url>");
        process.exit(1);
      }
      return handleFileIngest(targetPath, opts, ctx);
    });

  return cmd;
}

// ─── URL → Sources 处理器：网页剪藏 ─────────────────────────────────

/**
 * @description 处理 URL 网页剪藏，将内容保存到 50-Knowledge/Sources/ 目录
 * @param opts - 命令行选项（url, selector, title, dryRun 等）
 * @param ctx - CLI 上下文
 */
async function handleClipToSources(opts: any, ctx: any) {
  const url = opts.url;
  if (!url) {
    console.error("❌ --url is required for --to-sources mode");
    process.exit(1);
  }

  // 获取 vault 根目录（支持多种来源）
  const vaultRoot = ctx?.vault?.root ?? ctx?.vaultRoot ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  const sourcesDir = path.join(vaultRoot, "50-Knowledge", "Sources");

  console.log(`\n🌐 Clipping: ${url}`);
  console.log(`📂 Target:   ${sourcesDir}\n`);

  try {
    // 执行网页内容提取
    const result = await clipWebPage({
      url,
      selector: opts.selector,
      title: opts.title,
    });

    // 输出提取摘要信息
    row("Title", result.title || "(none)", "36");
    row("Author", result.author || "(none)", "33");
    row("Method", result.method, "32");
    row("Content", `${result.content.length} chars`, "36");
    row("Word count", `${result.wordCount}`, "33");

    // 干运行模式：只显示预览不写入
    if (opts.dryRun) {
      console.log("\n(dry-run: no files written)\n");
      console.log("=== Content preview (first 2000 chars) ===\n");
      console.log(result.content.substring(0, 2000));
      return;
    }

    // 确保 Sources 目录存在
    if (!fs.existsSync(sourcesDir)) {
      fs.mkdirSync(sourcesDir, { recursive: true });
    }

    // 生成安全的文件名（移除特殊字符）
    const safeTitle = (opts.title || result.title || "untitled")
      .replace(/[/\\:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    const filename = `${safeTitle}.md`;

    // 构建包含 frontmatter 的完整 Markdown 内容
    const captured = new Date().toISOString().split("T")[0];
    const frontmatter = [
      "---",
      "type: Source",
      `title: "${(opts.title || result.title || "").replace(/"/g, '\\"')}"`,
      `author: "${(result.author || "").replace(/"/g, '\\"')}"`,
      `source_url: "${url}"`,
      `platform: "${result.site}"`,
      `captured: ${captured}`,
      `extraction_method: ${result.method}`,
      "---",
    ].join("\n");

    const fullContent = `${frontmatter}\n\n${result.content}`;
    const outPath = path.join(sourcesDir, filename);
    fs.writeFileSync(outPath, fullContent, "utf-8");

    console.log(`\n✅ Saved: ${filename}`);
    row("Path", outPath, "36");
    row("Size", `${fullContent.length} chars`, "33");

    // 更新 Sources 目录的索引文件
    updateSourcesMoc(sourcesDir, filename, opts.title || result.title || "untitled");
  } catch (err) {
    console.error(`\n❌ Clip failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * @description 更新 Sources 目录的 MOC 索引文件（00-INDEX.md）
 * 如果索引不存在则创建，存在则追加新条目
 * @param {string} sourcesDir - Sources 目录路径
 * @param {string} filename - 新增文件名
 * @param {string} title - 文章标题
 */
function updateSourcesMoc(sourcesDir: string, filename: string, title: string) {
  const indexPath = path.join(sourcesDir, "00-INDEX.md");
  const wikilink = `[[${filename.replace(/\.md$/, "")}]]`;

  if (!fs.existsSync(indexPath)) {
    // 索引不存在，创建新的 MOC 索引文件
    const content = [
      "---",
      "type: MOC",
      "title: Sources Index",
      "---",
      "",
      "# 原文存档索引",
      "",
      `> 最后更新：${new Date().toISOString().split("T")[0]}`,
      "",
      "## 文章",
      "",
      `- ${wikilink}`,
      "",
    ].join("\n");
    fs.writeFileSync(indexPath, content, "utf-8");
    console.log("   📝 Created Sources/00-INDEX.md");
  } else {
    // 索引已存在，检查是否已有该链接，没有则追加
    const existing = fs.readFileSync(indexPath, "utf-8");
    if (!existing.includes(wikilink)) {
      const updated = existing.replace(
        /(## 文章\n)/,
        `$1\n- ${wikilink}`,
      );
      fs.writeFileSync(indexPath, updated, "utf-8");
      console.log("   📝 Updated Sources/00-INDEX.md");
    }
  }
}

// ─── Finalize 处理器：从提取结果断点续传 ─────────────────────────────

/**
 * @description 从之前的提取结果（JSON）恢复执行管线后续阶段
 * 跳过 Stage 1（提取），直接执行 Stage 2（对齐）→ Stage 3（生成）→ Stage 4（分发）
 * @param opts - 命令行选项
 * @param ctx - CLI 上下文
 */
async function handleFinalize(opts: any, ctx: any) {
  let extractionJson: string;

  // 从 stdin 或文件读取提取结果 JSON
  if (opts.finalize === "-") {
    // 从标准输入读取
    extractionJson = fs.readFileSync("/dev/stdin", "utf-8");
  } else {
    const filePath = path.resolve(opts.finalize);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }
    extractionJson = fs.readFileSync(filePath, "utf-8");
  }

  // 解析提取结果 JSON
  let extraction: { entities: ExtractedEntity[]; events: ExtractedEvent[]; source: SourceDocument };
  try {
    extraction = JSON.parse(extractionJson);
  } catch (e) {
    console.error(`❌ Invalid JSON: ${(e as Error).message}`);
    process.exit(1);
  }

  const vaultRoot = ctx?.vault?.root ?? ctx?.vaultRoot ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  const vault = ctx.vault;
  const llm = requireLLM(ctx);

  console.log("\n🔄 Finalizing from extraction result...\n");

  // ─── Stage 2: Vault 对齐 ───
  // 将提取的实体/事件与已有文档进行对齐，决定创建或合并
  console.log("   📐 Stage 2: Vault Alignment");
  const aligned = await alignToVault(extraction.entities, extraction.events, vault);

  row("Create", aligned.actions.filter(a => a.action === "create").length, "32");
  row("Merge", aligned.actions.filter(a => a.action === "merge").length, "33");
  row("Conflicts", aligned.conflicts.length, "31");

  // 输出冲突信息
  if (aligned.conflicts.length > 0) {
    console.log("\n   ⚠️  Conflicts (need resolution):");
    for (const c of aligned.conflicts) {
      console.log(`      ${c.new_name} ≈ ${c.candidates[0]?.title} (${(c.candidates[0]?.score * 100).toFixed(0)}%)`);
    }
  }

  // ─── Stage 3: 页面生成 ───
  // 使用 LLM 为每个实体/概念/事件生成 wiki 页面
  console.log("\n   📝 Stage 3: Page Generation");
  // 截断过长的源材料以控制 token 用量
  const truncatedSource = extraction.source.text.length > 8000
    ? extraction.source.text.slice(0, 8000) + "\n\n[... 源材料已截断 ...]"
    : extraction.source.text;

  const pages: { frontmatter: Record<string, any>; content: string }[] = [];

  // 为实体和概念生成页面
  for (const item of aligned.items) {
    try {
      const { CONCEPT_PROMPT, ENTITY_PROMPT, GENERATE_SYSTEM } = await import("../lib/ingest.js");
      const itemType = item.type === "concept" ? "concept" : "entity";
      const prompt = itemType === "concept"
        ? CONCEPT_PROMPT({ name: item.name, description: item.description, tags: item.tags }, truncatedSource)
        : ENTITY_PROMPT({ name: item.name, description: item.description, tags: item.tags }, truncatedSource);
      const pageRaw = await llm.complete(prompt, GENERATE_SYSTEM);
      const page = JSON.parse(pageRaw.content);
      if (page.frontmatter) page.frontmatter.title = item.name;
      pages.push(page);
    } catch (e) {
      console.error(`   ❌ Page generation failed for ${item.name}: ${(e as Error).message}`);
    }
  }

  // 为事件生成页面
  for (const event of aligned.events) {
    try {
      const { EVENT_PROMPT, GENERATE_SYSTEM } = await import("../lib/ingest.js");
      const prompt = EVENT_PROMPT({
        name: event.name,
        description: event.description,
        tags: event.tags,
        time: event.time,
        location: event.location,
        participants: event.participants,
      }, truncatedSource);
      const pageRaw = await llm.complete(prompt, GENERATE_SYSTEM);
      const page = JSON.parse(pageRaw.content);
      if (page.frontmatter) page.frontmatter.title = event.name;
      pages.push(page);
    } catch (e) {
      console.error(`   ❌ Page generation failed for ${event.name}: ${(e as Error).message}`);
    }
  }

  // ─── Stage 4: 分发到 Inbox ───
  // 将生成的页面和元数据写入 Inbox 批次目录
  console.log("\n   📥 Stage 4: Inbox Dispatch");
  const batch = dispatchToInbox(
    vaultRoot,
    extraction.source,
    pages,
    [], // stories（如果需要可单独处理）
    extraction.entities,
    extraction.events,
    aligned.actions,
    opts.batchId,
  );

  console.log(`\n✅ Batch created: ${batch.batch_id}`);
  row("Base dir", batch.base_dir, "36");
  row("Pages", batch.pages.length, "33");
  row("Status", batch.manifest.status, "32");
  console.log(`\n   学习完成后运行: wiki-engine archive --batch ${batch.batch_id}`);
}

// ─── 文件摄入（Inbox-first 模式）─────────────────────────────────────

/**
 * @description 处理文件/目录摄入，执行完整的 Inbox-first 管线
 * @param {string} targetPath - 要摄入的文件或目录路径
 * @param opts - 命令行选项
 * @param ctx - CLI 上下文
 */
async function handleFileIngest(targetPath: string, opts: any, ctx: any) {
  const absPath = path.resolve(targetPath);
  if (!fs.existsSync(absPath)) {
    console.error(`❌ Path not found: ${absPath}`);
    process.exit(1);
  }

  const vaultRoot = ctx?.vault?.root ?? ctx?.vaultRoot ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  const useInbox = opts.inbox !== false; // --no-inbox 设置 opts.inbox = false

  // 收集要摄入的文件列表
  const files: string[] = [];
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    // 目录模式：递归查找所有 .md 文件
    const { glob } = await import("glob");
    const found = await glob("**/*.md", { cwd: absPath, absolute: true });
    files.push(...found);
  } else {
    // 单文件模式
    files.push(absPath);
  }

  console.log(`\n📥 Ingesting ${files.length} file(s)${useInbox ? " → Inbox" : " → Permanent"}...\n`);

  // 扫描已有页面用于去重检测
  const existingPages = await ctx.vault.scan();
  console.log(`   Existing pages in vault: ${existingPages.length}\n`);

  // 逐个文件执行摄入管线
  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const title = path.basename(file, ".md");

    console.log(`━━━ Processing: ${title} ━━━`);

    const llm = requireLLM(ctx);
    if (llm.isInteractive()) {
      console.log("   🤖 Agent mode — prompt will be sent to Helios for analysis\n");
    }

    // ─── Stage 1: 内容提取 ───
    // 使用 LLM 从文本中提取实体、事件、概念等
    const result = await ingestText(content, llm, title, {
      skipStory: opts.story === false,
      generatePages: opts.pages !== false,
    });

    // 输出提取结果统计
    console.log(`\n   📊 Extracted:`);
    row("Entities", result.entities.filter(e => e.type === "entity").length, "36");
    row("Concepts", result.entities.filter(e => e.type === "concept").length, "33");
    row("Events", result.events.length, "32");
    row("Stories", result.stories.length, "36");
    row("Pages to create", result.pages.length, "33");

    // 显示发现的别名
    const withAliases = result.entities.filter(e => e.aliases && e.aliases.length > 0);
    if (withAliases.length > 0) {
      console.log(`\n   📛 Aliases found:`);
      for (const e of withAliases) {
        console.log(`      ${e.name} → ${e.aliases.join(", ")}`);
      }
    }

    // ─── 断点：提取完成后暂停（便于人工审查/编辑）───
    if (opts.stopAfter === "extraction") {
      const source: SourceDocument = {
        text: content,
        title,
        captured_at: new Date().toISOString(),
        source_type: "file",
      };

      const extractionOutput = {
        entities: result.entities,
        events: result.events,
        source,
      };

      // 将提取结果保存为 JSON，便于后续用 --finalize 恢复
      const outPath = path.resolve(`.extraction-${title}.json`);
      fs.writeFileSync(outPath, JSON.stringify(extractionOutput, null, 2), "utf-8");
      console.log(`\n   ⏸️  Stopped after extraction. Output: ${outPath}`);
      console.log(`   Edit the file if needed, then run:`);
      console.log(`   wiki-engine ingest --finalize ${outPath} --vault ${vaultRoot}`);
      return;
    }

    // ─── 旧版模式：直接写入 --out 目录 ───
    if (!useInbox) {
      await writeLegacy(result, opts, ctx);
      continue;
    }

    // ─── Inbox-first 管线 ───

    // ─── Stage 2: Vault 对齐 ───
    console.log(`\n   📐 Stage 2: Vault Alignment`);
    const aligned = await alignToVault(result.entities, result.events, ctx.vault);
    row("Create", aligned.actions.filter(a => a.action === "create").length, "32");
    row("Merge", aligned.actions.filter(a => a.action === "merge").length, "33");
    if (aligned.conflicts.length > 0) {
      row("Conflicts", aligned.conflicts.length, "31");
      for (const c of aligned.conflicts) {
        console.log(`      ⚠️  ${c.new_name} ≈ ${c.candidates[0]?.title} (${(c.candidates[0]?.score * 100).toFixed(0)}%)`);
      }
    }

    // ─── 断点：对齐完成后暂停 ───
    if (opts.stopAfter === "alignment") {
      console.log(`\n   ⏸️  Stopped after alignment.`);
      console.log(`   Actions:`);
      for (const a of aligned.actions) {
        console.log(`      ${a.action}: ${a.item_name} → ${a.resolved_name} (${a.reason})`);
      }
      return;
    }

    // 去重检测（仅报告，不自动处理）
    if (result.pages.length > 0) {
      const newPages: WikiPage[] = result.pages.map((p: any) => ({
        title: p.frontmatter?.title ?? "untitled",
        type: p.frontmatter?.type ?? "wiki",
        tags: p.frontmatter?.tags ?? [],
        aliases: p.frontmatter?.aliases ?? [],
        content: p.content ?? "",
        filePath: "",
        wikilinks: [],
      }));
      const matches = dedupScan(newPages, existingPages);
      if (matches.length > 0) {
        console.log(`\n   ⚠️  Dedup matches:`);
        for (const m of matches) {
          row(m.newTitle, `≈ ${m.existingTitle} (${(m.score * 100).toFixed(0)}%)`, "33");
        }
      }
    }

    // 干运行模式：只显示将要创建的目录结构
    if (opts.dryRun) {
      console.log(`\n   (dry-run: no files written)`);
      console.log(`\n   Would create batch:`);
      console.log(`     00-Inbox/wiki-engine/${generateBatchId(title)}/`);
      console.log(`     ├── concepts/ (${result.entities.filter(e => e.type === "concept").length} files)`);
      console.log(`     ├── entities/ (${result.entities.filter(e => e.type === "entity").length} files)`);
      console.log(`     ├── events/ (${result.events.length} files)`);
      console.log(`     ├── stories/ (${result.stories.length} files)`);
      console.log(`     └── _manifest.yaml`);
      continue;
    }

    // ─── Stage 4: 分发到 Inbox ───
    console.log(`\n   📥 Stage 4: Inbox Dispatch`);
    const source: SourceDocument = {
      text: content,
      title,
      captured_at: new Date().toISOString(),
      source_type: "file",
    };

    const batch = dispatchToInbox(
      vaultRoot,
      source,
      result.pages,
      result.stories,
      result.entities,
      result.events,
      aligned.actions,
      opts.batchId,
    );

    console.log(`\n✅ Batch created: ${batch.batch_id}`);
    row("Base dir", batch.base_dir, "36");
    row("Pages", batch.pages.length, "33");
    row("Status", batch.manifest.status, "32");
    console.log(`\n   学习完成后运行: wiki-engine archive --batch ${batch.batch_id}`);

    console.log();
  }
}

// ─── 旧版写入（直接写入 --out 目录）────────────────────────────────

/**
 * @description 旧版写入模式，将生成的页面直接写入指定输出目录（跳过 Inbox）
 * @param result - 内容提取结果
 * @param opts - 命令行选项
 * @param ctx - CLI 上下文
 */
async function writeLegacy(result: any, opts: any, ctx: any) {
  if (opts.dryRun) {
    console.log(`\n   (dry-run: no files written)`);
    return;
  }

  const outDir = path.resolve(opts.out);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 文档类型到子目录名的映射
  const typeDirMap: Record<string, string> = {
    entity: "entities",
    concept: "concepts",
    event: "events",
    story: "stories",
    wiki: "wikis",
    source: "sources",
  };

  // 写入故事文件
  if (result.stories.length > 0) {
    const storiesDir = path.join(outDir, "stories");
    if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });
    for (const story of result.stories) {
      const storyTitle = story.title || "untitled-story";
      const filename = `${storyTitle}.md`;
      const frontmatter = [
        "---",
        `title: "${storyTitle}"`,
        `type: "story"`,
        `source: "${story.sourceTitle || ""}"`,
        `source_type: "podcast"`,
        "---",
      ].join("\n");
      const outPath = path.join(storiesDir, filename);
      fs.writeFileSync(outPath, `${frontmatter}\n\n${story.content || ""}`);
      console.log(`   💾 Written: stories/${filename}`);
    }
  }

  // 写入实体/事件/概念等 wiki 页面
  for (const page of result.pages) {
    const fm = page.frontmatter ?? {};
    const typeDir = typeDirMap[fm.type] || "misc";
    const pageDir = path.join(outDir, typeDir);
    if (!fs.existsSync(pageDir)) fs.mkdirSync(pageDir, { recursive: true });

    const filename = `${fm.title ?? "untitled"}.md`;
    const frontmatter = [
      "---",
      ...Object.entries(fm).map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: [${v.map((x: any) => `"${x}"`).join(", ")}]`;
        return `${k}: "${v}"`;
      }),
      "---",
    ].join("\n");

    const outPath = path.join(pageDir, filename);
    fs.writeFileSync(outPath, `${frontmatter}\n\n${page.content ?? ""}`);
    console.log(`   💾 Written: ${typeDir}/${filename}`);
  }

  // 创建桩页面（stub pages）：为所有提到但未生成的实体创建占位页面
  if (opts.createStubs) {
    // 从所有页面和故事中提取 wikilinks
    const allWikilinks = new Set<string>();
    for (const page of result.pages) {
      const links = (page.content ?? "").match(/\[\[[^\]]+\]\]/g) || [];
      links.forEach((link: string) => {
        const name = link.replace(/\[\[|\]\]/g, '');
        allWikilinks.add(name);
      });
    }
    for (const story of result.stories) {
      const links = (story.content ?? "").match(/\[\[[^\]]+\]\]/g) || [];
      links.forEach((link: string) => {
        const name = link.replace(/\[\[|\]\]/g, '');
        allWikilinks.add(name);
      });
    }

    // 收集已存在的页面标题
    const existingTitles = new Set(result.pages.map((p: any) => p.frontmatter?.title));
    for (const story of result.stories) {
      existingTitles.add(story.title);
    }

    // 为不存在的链接目标创建桩页面
    let stubCount = 0;
    for (const linkName of allWikilinks) {
      if (!existingTitles.has(linkName)) {
        const stubPage = {
          frontmatter: { title: linkName, type: "entity", tags: ["stub"], aliases: [] },
          content: `# ${linkName}\n\n*Stub page — needs expansion.*\n\n## 关联\n\n`
        };
        const fm = stubPage.frontmatter;
        const filename = `${fm.title}.md`;
        const frontmatter = [
          "---",
          ...Object.entries(fm).map(([k, v]) => {
            if (Array.isArray(v)) return `${k}: [${v.map((x: any) => `"${x}"`).join(", ")}]`;
            return `${k}: "${v}"`;
          }),
          "---",
        ].join("\n");

        const stubDir = path.join(outDir, "entities");
        if (!fs.existsSync(stubDir)) fs.mkdirSync(stubDir, { recursive: true });
        const outPath = path.join(stubDir, filename);
        fs.writeFileSync(outPath, `${frontmatter}\n\n${stubPage.content}`);
        console.log(`   📝 Stub: entities/${filename}`);
        stubCount++;
      }
    }
    if (stubCount > 0) {
      console.log(`\n   ✅ Created ${stubCount} stub pages`);
    }
  }
}
