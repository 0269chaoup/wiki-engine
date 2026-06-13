---
name: wiki-engine
description: "Obsidian vault 知识整理引擎。用于：(1) 外部知识内容自动入库（文档/网页/文章 → wiki 概念文档）；(2) vault 分析（知识图谱/去重/关联）；(3) 搜索/检查；(4) 双链补全（扫描未链接的概念提及，自动补 [[wikilink]]）。"
triggers:
  # 外部知识 → 入库
  - "整理到 wiki"
  - "记录到知识库"
  - "ingest"
  - "wiki 页面"
  - "知识整理"
  - "概念文档"
  - "分析"
  # Vault 分析
  - "vault 分析"
  - "知识图谱"
  - "找关联"
  - "去重"
  - "重复检测"
  - "图谱"
  - "孤立页面"
  - "orphan"
  - "graph"
  - "dedup"
  - "connections"
  # 搜索/检查
  - "wiki-engine"
  - "vault search"
  - "搜索笔记"
  - "查找笔记"
  - "check-links"
  - "双链检查"
  - "broken links"
  - "MOC 链接"
  # 双链补全
  - "backlink-scan"
  - "双链补全"
  - "补全链接"
  - "unlinked"
---

# wiki-engine CLI

Obsidian Vault 知识网络分析引擎 — 图谱构建、连接发现、去重检测、内容导入、双链补全一站式 CLI 工具。

## 安装

```bash
git clone <repo-url> wiki-engine
cd wiki-engine
npm install
npm run build
npm link
```

## Output Structure

### Inbox (学习阶段)
```
00-Inbox/wiki-engine/
└── ingest-YYYYMMDD-{slug}/
    ├── _manifest.yaml          # 批次元数据（状态追踪）
    ├── concepts/
    ├── entities/
    ├── events/
    └── stories/
```

### Permanent (归档后)
```
50-Knowledge/Permanent/
├── Concepts/
├── Entities/
├── Events/
├── Stories/
└── MOCs/
```

## Commands

```bash
# ─── Backlink Scan (双链补全) ───
# Scan vault for unlinked concept mentions and add [[wikilinks]]
wiki-engine backlink-scan --vault <vault-path> --dry-run

# Apply changes
wiki-engine backlink-scan --vault <vault-path>

# Options:
#   --dir <name>         Target directory (default: 50-Knowledge)
#   --min-len <n>        Min concept name length (default: 2)
#   --max-per-file <n>   Max links per file per run (default: 20)
#   --dry-run            Preview only
#   --json               JSON output

# ─── Quick vault overview (no LLM needed)
wiki-engine scan --vault <vault-path> --tags

# Build knowledge graph (no LLM needed)
wiki-engine graph --vault <vault-path> --top 20 --orphans --bridges

# Find connections for a note (needs LLM)
wiki-engine connect "note title" --vault <vault-path> --llm api

# Detect duplicates (no LLM for stage 1-2, optional LLM for stage 3)
wiki-engine dedup --vault <vault-path> --threshold 0.6

# ─── Ingest (Inbox-first, default) ───
# Ingest → Inbox with vault alignment
wiki-engine ingest ./note.md --vault <vault-path> --llm agent

# Ingest with dry-run (preview only)
wiki-engine ingest ./note.md --vault <vault-path> --dry-run

# Ingest → stop after extraction (for agent review)
wiki-engine ingest ./note.md --vault <vault-path> --stop-after extraction
# Then resume: wiki-engine ingest --finalize .extraction-{title}.json

# Ingest → legacy mode (direct to Permanent, no Inbox)
wiki-engine ingest ./note.md --vault <vault-path> --no-inbox --out wiki

# Ingest with stub pages for all mentioned entities
wiki-engine ingest ./note.md --vault <vault-path> --llm agent --create-stubs

# Clip a web page → Sources/ (no LLM needed)
wiki-engine ingest --to-sources --url "https://example.com/article" --vault <vault-path>

# ─── Archive (Inbox → Permanent) ───
# List all pending batches
wiki-engine archive --list --vault <vault-path>

# Archive a batch (default: merge strategy)
wiki-engine archive --batch ingest-20260601-pca --vault <vault-path>

# Archive with dry-run preview
wiki-engine archive --batch ingest-20260601-pca --dry-run

# Archive with specific conflict strategy
wiki-engine archive --batch ingest-20260601-pca --strategy overwrite

# Archive skip LLM dedup (faster, simple append)
wiki-engine archive --batch ingest-20260601-pca --no-dedup

# ─── Check Links (MOC 双链检查) ───
# Scan all MOC files for broken wikilinks
wiki-engine check-links --vault <vault-path>

# Auto-fix (remove path prefixes, fix name mismatches)
wiki-engine check-links --vault <vault-path> --fix

# JSON output (for agent consumption)
wiki-engine check-links --vault <vault-path> --json

# ─── Search (Phase 1: local fuzzy) ───
# Basic keyword search (fuzzy, across title/tags/alias/content)
wiki-engine search "渲染管线" --vault <vault-path>

# Filter by type
wiki-engine search "GPU" --type concept --vault <vault-path>

# Filter by domain
wiki-engine search "AI" --domain "AI与大模型" --vault <vault-path>

# Filter by status
wiki-engine search "AI" --status "📥 待学习" --vault <vault-path>

# Exact mode (title/alias only, no content matching)
wiki-engine search "着色器" --level exact --vault <vault-path>

# Full content search
wiki-engine search "光栅化" --level content --vault <vault-path>

# JSON output (for agent consumption)
wiki-engine search "GPU" --json --top 5 --vault <vault-path>

# Limit results
wiki-engine search "AI" --top 5 --vault <vault-path>
```

## Workflow: External Content → Concept Document

When the user provides an external link (article, blog, etc.) and asks to "record using wiki-engine":

### Phase 1: Ingest to Inbox (学习阶段)

1. **Read & analyze** the external content (browser or web_extract)
2. **Classify** into the four-layer ontology: Concept / Entity / Event / Story
3. **Write to Inbox** (NOT Permanent): `00-Inbox/wiki-engine/{batch_id}/`
   - `{batch_id}` format: `ingest-YYYYMMDD-{topic-slug}`
   - Subdirectories match Permanent structure: `concepts/`, `entities/`, `events/`, `stories/`
4. **Generate MOC** entry file at `00-Inbox/wiki-engine/{batch_id}/MOC-{topic}.md`
5. **Use correct frontmatter**:
```yaml
---
type: Concept
domain: 计算机图形学
tags:
- tag1
- tag2
status: 📥 待学习
created: '2026-05-31'
source: https://...
---
```

### Phase 2: User Learning (用户学习)

- User reviews content in Inbox
- Can invoke deep-dive reading tools
- Derived files track `derived_from: {batch_id}` in frontmatter

### Phase 3: Archive to Permanent (归档)

**Only after user says "归档"** — NEVER auto-archive.

Trigger: user says "归档 {batch_id}" or "这批可以归档了"

Archive rules:
1. Move each subdirectory to corresponding Permanent location:
   - `concepts/*` → `50-Knowledge/Permanent/Concepts/`
   - `entities/*` → `50-Knowledge/Permanent/Entities/`
   - `events/*` → `50-Knowledge/Permanent/Events/`
   - `stories/*` → `50-Knowledge/Permanent/Stories/`
   - `MOC-*` → `50-Knowledge/MOCs/`
2. **Check for name conflicts** — 4 strategies: `merge` (default), `overwrite`, `rename`, `skip`
3. **Update frontmatter**: `status: 📥 待学习` → `status: 🗃️ 已归档`, add `archived: 'YYYY-MM-DD'`
4. **Update existing MOCs** — if a MOC for the domain exists, add new entries
5. **Delete Inbox directory** after successful archive

### ⚠️ Known Limitations

- **merge dedup**: Current merge uses simple append (`## 🔄 补充收录` separator), LLM dedup pending
- **Image migration**: Archives don't auto-migrate images, warns user to handle manually
- **--stop-after alignment**: No --finalize resume after pause (must re-run full ingest)

## Backlink Scan Details

### How it works

1. Scans all pages in target directory to build a concept index (title + aliases)
2. For each file, reads content (skips frontmatter and code blocks)
3. Checks if any concept title/alias appears in text but NOT wrapped in `[[...]]`
4. Replaces the first occurrence with `[[concept_name]]`
5. Generates a change report

### Stopwords

Built-in stopword list filters common English words (`note`, `skill`, `error`, `event`, `story`, `data`, `code`, `test`, `api`, `url`, etc.) to avoid false matches. To extend, edit `STOPWORDS` in `src/commands/backlink-scan.ts`.

### Protection rules

- Only processes `50-Knowledge/`, skips Inbox
- Frontmatter, code blocks (`` ``` ``), inline code (`` ` ``) are skipped
- Existing `[[wikilinks]]` are not duplicated
- Each concept is linked only once per file (first occurrence)
- No self-referencing (file doesn't link its own title)
- Minimum concept name length: 2 characters
- Pure numeric titles are skipped

### Recommended workflow

```bash
# Step 1: Preview (dry-run)
wiki-engine backlink-scan --vault <vault-path> --dry-run

# Step 2: Review output — confirm link placements are reasonable

# Step 3: Apply
wiki-engine backlink-scan --vault <vault-path>
```

## MOC Link Maintenance

**Problem**: MOC files use path prefixes in wikilinks (e.g., `[[AI/MCP/xxx]]`), but files are actually at `50-Knowledge/Permanent/Concepts/xxx.md`. After file moves/refactors, MOC links don't auto-update.

**Solution**:
1. `wiki-engine check-links` — regular scan for broken links
2. `wiki-engine check-links --fix` — auto-fix: remove path prefixes, fix name mismatches
3. **Convention**: MOC links use `[[filename]]` (no path prefix), let Obsidian resolve

**Link issue types**:
- `prefix` — redundant path prefix (e.g., `AI/MCP/xxx`, should be `xxx`)
- `name_mismatch` — filename mismatch (spaces, punctuation, numbering prefix differences)
- `missing` — truly missing files

**⚠️ --fix fuzzy matching may misfire**: `name_mismatch` suggestions come from fuzzy matching and may be wrong. Safe approach: only trust `--fix` for `prefix` issues. Verify `name_mismatch` and `missing` manually.

## LLM Modes

- `--llm agent` — **Default mode**. Pipe protocol: CLI writes prompt to stdout → waits for stdin reply. Requires an AI agent as orchestrator. **Limitation**: cannot run standalone in terminal (no one to read/write the pipe).
- `--llm api` — Direct API call (requires `ANTHROPIC_AUTH_TOKEN`). Can run standalone in terminal.

## Key Flags

**Global:**
- `--vault <path>` — Vault root (default: `$OBSIDIAN_VAULT` or cwd)
- `--llm <provider>` — LLM provider: `agent` (default) | `api` (direct call)
- `--dry-run` — Show what would happen without writing
- `--json` — JSON output for piping
- `--verbose` — Extra detail

**Ingest-specific:**
- `--no-inbox` — Skip Inbox, write directly to --out (legacy behavior)
- `--stop-after <stage>` — Pause after `extraction` or `alignment`
- `--finalize <json>` — Resume from extraction result JSON file
- `--batch-id <id>` — Custom batch ID (default: auto-generated `ingest-YYYYMMDD-{slug}`)
- `--no-story` — Skip story generation
- `--create-stubs` — Create stub pages for all mentioned entities

**Archive-specific:**
- `--batch <id>` — Batch ID to archive
- `--list` — List all pending batches
- `--strategy <mode>` — Conflict strategy: `merge` (default) | `overwrite` | `rename` | `skip`
- `--no-dedup` — Skip LLM dedup, simple append on merge
