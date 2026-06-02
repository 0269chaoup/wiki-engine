import fs from "fs";
import path from "path";
import type { SourceDocument, InboxBatch, BatchManifest, AlignmentAction, ExtractedEntity, ExtractedEvent, ExtractedStory } from "./types.js";
import { writeManifest, generateBatchId } from "./manifest.js";

/**
 * Stage 4: Inbox Dispatch
 *
 * Writes generated pages to 00-Inbox/wiki-engine/{batch_id}/ with proper
 * directory structure and creates _manifest.yaml.
 */
export function dispatchToInbox(
  vaultRoot: string,
  source: SourceDocument,
  pages: { frontmatter: Record<string, any>; content: string }[],
  stories: ExtractedStory[],
  entities: ExtractedEntity[],
  events: ExtractedEvent[],
  alignmentActions: AlignmentAction[],
  batchId?: string,
): InboxBatch {
  const bid = batchId ?? generateBatchId(source.title);
  const inboxDir = path.join(vaultRoot, "00-Inbox", "wiki-engine", bid);

  // Create directory structure
  const dirs = ["concepts", "entities", "events", "stories"];
  for (const d of dirs) {
    fs.mkdirSync(path.join(inboxDir, d), { recursive: true });
  }

  const dispatched: InboxBatch["pages"] = [];

  // Write stories
  for (const story of stories) {
    const storyTitle = story.title || "untitled-story";
    const filename = `${sanitizeFilename(storyTitle)}.md`;
    const frontmatter = buildFrontmatter({
      title: storyTitle,
      type: "Story",
      tags: story.tags,
      status: "📥 待学习",
      created: new Date().toISOString().split("T")[0],
      source: source.url ?? source.title,
    });
    const filePath = path.join("stories", filename);
    fs.writeFileSync(path.join(inboxDir, filePath), `${frontmatter}\n\n${story.content || ""}`, "utf-8");
    dispatched.push({
      page: { frontmatter: { title: storyTitle, type: "story" }, content: story.content || "" },
      path: filePath,
    });
  }

  // Write entity/event/concept pages
  const typeDirMap: Record<string, string> = {
    entity: "entities",
    concept: "concepts",
    event: "events",
    story: "stories",
  };

  for (const page of pages) {
    const fm = page.frontmatter ?? {};
    const typeDir = typeDirMap[fm.type] || "concepts";
    const filename = `${sanitizeFilename(fm.title ?? "untitled")}.md`;

    // Enrich frontmatter with pipeline metadata
    const enrichedFm = {
      ...fm,
      status: "📥 待学习",
      created: fm.created ?? new Date().toISOString().split("T")[0],
      source: fm.source ?? (source.url ?? source.title),
    };

    const frontmatter = buildFrontmatter(enrichedFm);
    const filePath = path.join(typeDir, filename);
    fs.writeFileSync(path.join(inboxDir, filePath), `${frontmatter}\n\n${page.content ?? ""}`, "utf-8");
    dispatched.push({ page, path: filePath });
  }

  // Build manifest
  const manifest: BatchManifest = {
    batch_id: bid,
    source,
    created_at: new Date().toISOString().split("T")[0],
    items_count: {
      entities: entities.filter(e => e.type === "entity").length,
      events: events.length,
      stories: stories.length,
      concepts: entities.filter(e => e.type === "concept").length,
    },
    alignment_actions: alignmentActions,
    status: "pending",
  };

  writeManifest(inboxDir, manifest);

  return {
    batch_id: bid,
    base_dir: path.relative(vaultRoot, inboxDir),
    pages: dispatched,
    manifest,
  };
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function buildFrontmatter(data: Record<string, any>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) {
          lines.push(`  - "${String(item).replace(/"/g, '\\"')}"`);
        }
      }
    } else if (typeof v === "string") {
      // Quote strings that look like dates or contain special chars
      if (/^\d{4}-\d{2}-\d{2}/.test(v) || /[:#{}[\],&*?|>!%@`]/.test(v)) {
        lines.push(`${k}: '${v}'`);
      } else {
        lines.push(`${k}: "${v}"`);
      }
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}
