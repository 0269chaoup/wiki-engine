import { Command } from "commander";
import fs from "fs";
import path from "path";
import { buildContext, requireLLM, row } from "../lib/cli-utils.js";
import { ingestText, buildAnalyzePrompt } from "../lib/ingest.js";
import { dedupScan } from "../lib/dedup.js";
import { clipWebPage } from "../lib/clip.js";
import type { WikiPage } from "../lib/types.js";

export function ingestCommand(): Command {
  const cmd = new Command("ingest")
    .description("Ingest content — from local files or clip a URL to Sources/")
    .argument("[path]", "file or directory to ingest (omit when using --url)")
    .option("--dry-run", "show what would be created without writing")
    .option("--no-story", "skip story generation")
    .option("--no-pages", "skip wiki page generation (analyze only)")
    .option("--out <dir>", "output directory for generated pages", "wiki")
    .option("--create-stubs", "create stub pages for all mentioned entities")
    // ─── New: URL → Sources mode ───
    .option("--url <url>", "clip a web page from this URL")
    .option("--to-sources", "save clipped content to 50-Knowledge/Sources/")
    .option("--selector <css>", "CSS selector for content extraction (override auto-detect)")
    .option("--title <title>", "override title for the clipped article")
    .action(async (targetPath: string | undefined, opts, cmd) => {
      const ctx = buildContext(cmd.parent.opts());

      // ─── URL → Sources mode ───
      if (opts.url || opts.toSources) {
        return handleClipToSources(opts, ctx);
      }

      // ─── Legacy: file-based ingest ───
      if (!targetPath) {
        console.error("❌ Please provide a <path> or use --url <url>");
        process.exit(1);
      }
      return handleFileIngest(targetPath, opts, ctx);
    });

  return cmd;
}

// ─── URL → Sources handler ────────────────────────────────────────

async function handleClipToSources(opts: any, ctx: any) {
  const url = opts.url;
  if (!url) {
    console.error("❌ --url is required for --to-sources mode");
    process.exit(1);
  }

  const vaultRoot = ctx?.vault?.root ?? ctx?.vaultRoot ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  const sourcesDir = path.join(vaultRoot, "50-Knowledge", "Sources");

  console.log(`\n🌐 Clipping: ${url}`);
  console.log(`📂 Target:   ${sourcesDir}\n`);

  try {
    const result = await clipWebPage({
      url,
      selector: opts.selector,
      title: opts.title,
    });

    row("Title", result.title || "(none)", "36");
    row("Author", result.author || "(none)", "33");
    row("Method", result.method, "32");
    row("Content", `${result.content.length} chars`, "36");
    row("Word count", `${result.wordCount}`, "33");

    if (opts.dryRun) {
      console.log("\n(dry-run: no files written)\n");
      console.log("=== Content preview (first 2000 chars) ===\n");
      console.log(result.content.substring(0, 2000));
      return;
    }

    // Ensure Sources dir exists
    if (!fs.existsSync(sourcesDir)) {
      fs.mkdirSync(sourcesDir, { recursive: true });
    }

    // Build filename from title
    const safeTitle = (opts.title || result.title || "untitled")
      .replace(/[/\\:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    const filename = `${safeTitle}.md`;

    // Build frontmatter
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

    // Update Sources MOC
    updateSourcesMoc(sourcesDir, filename, opts.title || result.title || "untitled");
  } catch (err) {
    console.error(`\n❌ Clip failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

// ─── Update Sources 00-INDEX.md ───────────────────────────────────

function updateSourcesMoc(sourcesDir: string, filename: string, title: string) {
  const indexPath = path.join(sourcesDir, "00-INDEX.md");
  const wikilink = `[[${filename.replace(/\.md$/, "")}]]`;

  if (!fs.existsSync(indexPath)) {
    // Create index
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
    // Append to index
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

// ─── Legacy: file-based ingest ─────────────────────────────────────

async function handleFileIngest(targetPath: string, opts: any, ctx: any) {
  const absPath = path.resolve(targetPath);
  if (!fs.existsSync(absPath)) {
    console.error(`❌ Path not found: ${absPath}`);
    process.exit(1);
  }

  // Gather files to ingest
  const files: string[] = [];
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    const { glob } = await import("glob");
    const found = await glob("**/*.md", { cwd: absPath, absolute: true });
    files.push(...found);
  } else {
    files.push(absPath);
  }

  console.log(`\n📥 Ingesting ${files.length} file(s)...\n`);

  // Load existing pages for dedup
  const existingPages = await ctx.vault.scan();
  console.log(`   Existing pages in vault: ${existingPages.length}\n`);

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const title = path.basename(file, ".md");

    console.log(`━━━ Processing: ${title} ━━━`);

    const llm = requireLLM(ctx);
    if (llm.isInteractive()) {
      console.log("   🤖 Agent mode — prompt will be sent to Helios for analysis\n");
    }

    // Run ingest pipeline
    const result = await ingestText(content, llm, title, {
      skipStory: opts.story === false,
      generatePages: opts.pages !== false,
    });

    // Report results
    console.log(`\n   📊 Extracted:`);
    row("Entities", result.entities.length, "36");
    row("Events", result.events.length, "33");
    row("Stories", result.stories.length, "32");
    row("Pages to create", result.pages.length, "36");

    // Dedup check
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

    // Write pages (unless dry-run)
    if (!opts.dryRun) {
      const outDir = path.resolve(opts.out);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const typeDirMap: Record<string, string> = {
        entity: "entities",
        concept: "concepts",
        event: "events",
        story: "stories",
        wiki: "wikis",
        source: "sources",
      };

      // Write stories
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

      // Write entity/event/concept pages
      for (const page of result.pages) {
        const fm = page.frontmatter ?? {};
        const typeDir = typeDirMap[fm.type] || "misc";
        const pageDir = path.join(outDir, typeDir);
        if (!fs.existsSync(pageDir)) fs.mkdirSync(pageDir, { recursive: true });

        const filename = `${fm.title ?? "untitled"}.md`;
        const frontmatter = [
          "---",
          ...Object.entries(fm).map(([k, v]) => {
            if (Array.isArray(v)) return `${k}: [${v.map(x => `"${x}"`).join(", ")}]`;
            return `${k}: "${v}"`;
          }),
          "---",
        ].join("\n");

        const outPath = path.join(pageDir, filename);
        fs.writeFileSync(outPath, `${frontmatter}\n\n${page.content ?? ""}`);
        console.log(`   💾 Written: ${typeDir}/${filename}`);
      }

      // Create stub pages for mentioned entities (--create-stubs)
      if (opts.createStubs) {
        const allWikilinks = new Set<string>();
        for (const page of result.pages) {
          const links = (page.content ?? "").match(/\[\[([^\]]+)\]\]/g) || [];
          links.forEach((link: string) => {
            const name = link.replace(/\[\[|\]\]/g, '');
            allWikilinks.add(name);
          });
        }
        for (const story of result.stories) {
          const links = (story.content ?? "").match(/\[\[([^\]]+)\]\]/g) || [];
          links.forEach((link: string) => {
            const name = link.replace(/\[\[|\]\]/g, '');
            allWikilinks.add(name);
          });
        }

        const existingTitles = new Set(result.pages.map((p: any) => p.frontmatter?.title));
        for (const story of result.stories) {
          existingTitles.add(story.title);
        }

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
                if (Array.isArray(v)) return `${k}: [${v.map(x => `"${x}"`).join(", ")}]`;
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
    } else if (opts.dryRun) {
      console.log(`\n   (dry-run: no files written)`);
    }

    console.log();
  }
}
