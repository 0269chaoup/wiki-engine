import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";
import type { WikiPage, PageType } from "./types.js";

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export class VaultReader {
  constructor(public root: string) {
    if (!fs.existsSync(root)) throw new Error(`Vault not found: ${root}`);
  }

  /** Scan all .md files, return parsed WikiPages */
  async scan(opts?: {
    includeDirs?: string[];
    excludeDirs?: string[];
    maxFiles?: number;
  }): Promise<WikiPage[]> {
    const exclude = [
      ".obsidian", ".git", ".trash", "node_modules",
      ...(opts?.excludeDirs ?? []),
    ];
    const patterns = opts?.includeDirs?.map(d => `${d}/**/*.md`) ?? ["**/*.md"];

    const files: string[] = [];
    for (const p of patterns) {
      const found = await glob(p, { cwd: this.root, ignore: exclude.map(d => `**/${d}/**`), absolute: false });
      files.push(...found);
    }

    const unique = [...new Set(files)].slice(0, opts?.maxFiles ?? Infinity);
    return unique.map(f => this.parseFile(f)).filter(Boolean) as WikiPage[];
  }

  /** Parse single file → WikiPage */
  parseFile(relativePath: string): WikiPage | null {
    const abs = path.join(this.root, relativePath);
    if (!fs.existsSync(abs)) return null;

    try {
      const raw = fs.readFileSync(abs, "utf-8");
      const { data, content } = matter(raw);

      const title = data.title ?? data.aliases?.[0] ?? path.basename(relativePath, ".md");
      const type = (data.type ?? "wiki") as PageType;
      const tags: string[] = data.tags ?? [];
      const aliases: string[] = data.aliases ?? [];

      const wikilinks: string[] = [];
      let m: RegExpExecArray | null;
      const re = new RegExp(WIKILINK_RE.source, "g");
      while ((m = re.exec(content)) !== null) {
        wikilinks.push(m[1].trim());
      }

      return { title, type, tags, aliases, content, filePath: relativePath, wikilinks };
    } catch {
      return null;
    }
  }

  /** Write a new page to vault */
  writePage(relativePath: string, content: string): void {
    const abs = path.join(this.root, relativePath);
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }

  /** Check if a page exists */
  hasPage(title: string): boolean {
    // Check by filename match
    const candidates = glob.sync(`**/${title}.md`, { cwd: this.root, ignore: [".obsidian/**", ".git/**"] });
    return candidates.length > 0;
  }

  /** Get all page titles (for wikilink resolution) */
  async getAllTitles(): Promise<Map<string, string>> {
    const pages = await this.scan();
    const map = new Map<string, string>();
    for (const p of pages) {
      map.set(p.title.toLowerCase(), p.filePath);
      for (const a of p.aliases) {
        map.set(a.toLowerCase(), p.filePath);
      }
    }
    return map;
  }
}
