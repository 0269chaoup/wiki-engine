/**
 * @file Vault 读取器模块
 *
 * 提供对 Obsidian vault 的文件系统操作，包括：
 * - 扫描并解析所有 Markdown 文件为 WikiPage 对象
 * - 写入新页面
 * - 检查页面是否存在
 * - 获取所有页面标题（用于 wikilink 解析）
 *
 * 使用 gray-matter 解析 frontmatter，使用 glob 进行文件匹配。
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";
import type { WikiPage, PageType } from "./types.js";

/**
 * Wikilink 正则表达式
 * 匹配 [[target]] 或 [[target|alias]] 格式的 Obsidian 内部链接
 * 捕获组 1：链接目标名称
 */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Vault 读取器类
 *
 * 封装了对 Obsidian vault 根目录的所有文件操作。
 * 提供扫描、解析、写入和查询功能。
 */
export class VaultReader {
  /**
   * 构造函数
   * @param root - vault 根目录的绝对路径
   * @throws 当指定的 vault 目录不存在时抛出错误
   */
  constructor(public root: string) {
    if (!fs.existsSync(root)) throw new Error(`Vault not found: ${root}`);
  }

  /**
   * 扫描 vault 中的所有 Markdown 文件并解析为 WikiPage 数组
   *
   * 支持选项：
   * - includeDirs：只扫描指定子目录
   * - excludeDirs：排除指定子目录
   * - maxFiles：最大文件数量限制
   *
   * 默认排除目录：.obsidian、.git、.trash、node_modules
   *
   * @param opts - 扫描选项
   * @returns 解析后的 WikiPage 数组
   */
  async scan(opts?: {
    /** 只扫描这些子目录下的文件 */
    includeDirs?: string[];
    /** 排除这些子目录 */
    excludeDirs?: string[];
    /** 最大扫描文件数量 */
    maxFiles?: number;
  }): Promise<WikiPage[]> {
    /** 构建排除目录列表（始终排除系统目录） */
    const exclude = [
      ".obsidian", ".git", ".trash", "node_modules",
      ...(opts?.excludeDirs ?? []),
    ];
    /** 构建扫描模式列表 */
    const patterns = opts?.includeDirs?.map(d => `${d}/**/*.md`) ?? ["**/*.md"];

    /** 使用 glob 模式匹配文件 */
    const files: string[] = [];
    for (const p of patterns) {
      const found = await glob(p, { cwd: this.root, ignore: exclude.map(d => `**/${d}/**`), absolute: false });
      files.push(...found);
    }

    /** 去重并限制数量，然后逐个解析 */
    const unique = [...new Set(files)].slice(0, opts?.maxFiles ?? Infinity);
    return unique.map(f => this.parseFile(f)).filter(Boolean) as WikiPage[];
  }

  /**
   * 解析单个 Markdown 文件为 WikiPage 对象
   *
   * 解析流程：
   * 1. 读取文件内容
   * 2. 使用 gray-matter 分离 frontmatter 和正文
   * 3. 从 frontmatter 提取标题、类型、标签、别名
   * 4. 从正文中提取所有 wikilink
   *
   * @param relativePath - 相对于 vault 根目录的文件路径
   * @returns 解析后的 WikiPage 对象，解析失败时返回 null
   */
  parseFile(relativePath: string): WikiPage | null {
    const abs = path.join(this.root, relativePath);
    if (!fs.existsSync(abs)) return null;

    try {
      const raw = fs.readFileSync(abs, "utf-8");
      /** 分离 frontmatter 元数据和正文内容 */
      const { data, content } = matter(raw);

      /** 提取标题：优先使用 title 字段，其次使用第一个别名，最后使用文件名 */
      const title = data.title ?? data.aliases?.[0] ?? path.basename(relativePath, ".md");
      /** 提取页面类型，默认为 wiki */
      const type = (data.type ?? "wiki") as PageType;
      /** 提取标签和别名列表 */
      const tags: string[] = data.tags ?? [];
      const aliases: string[] = data.aliases ?? [];

      /** 使用正则表达式提取所有 wikilink 目标 */
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

  /**
   * 将新页面写入 vault
   *
   * 如果目标目录不存在，会自动创建（递归）。
   *
   * @param relativePath - 相对于 vault 根目录的文件路径
   * @param content - 文件内容（Markdown 格式）
   */
  writePage(relativePath: string, content: string): void {
    const abs = path.join(this.root, relativePath);
    const dir = path.dirname(abs);
    /** 确保目标目录存在 */
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }

  /**
   * 检查指定标题的页面是否存在于 vault 中
   *
   * 通过文件名匹配进行查找。
   *
   * @param title - 页面标题
   * @returns 页面是否存在
   */
  hasPage(title: string): boolean {
    /** 通过 glob 模式查找匹配的文件 */
    const candidates = glob.sync(`**/${title}.md`, { cwd: this.root, ignore: [".obsidian/**", ".git/**"] });
    return candidates.length > 0;
  }

  /**
   * 获取所有页面标题的映射表（用于 wikilink 解析）
   *
   * 返回一个 Map，key 为小写化的标题或别名，value 为文件路径。
   * 支持通过标题和别名两种方式查找页面。
   *
   * @returns 标题→文件路径的映射表
   */
  async getAllTitles(): Promise<Map<string, string>> {
    const pages = await this.scan();
    const map = new Map<string, string>();
    for (const p of pages) {
      /** 以小写形式存储标题映射（不区分大小写查找） */
      map.set(p.title.toLowerCase(), p.filePath);
      /** 同时注册所有别名 */
      for (const a of p.aliases) {
        map.set(a.toLowerCase(), p.filePath);
      }
    }
    return map;
  }
}
