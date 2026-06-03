/**
 * @file 网页剪藏模块
 *
 * 从 URL 抓取网页内容并转换为 Markdown 格式。
 * 采用三层提取策略：
 *   1. defuddle（自动检测 90%+ 网站的内容区域）
 *   2. 已知站点选择器回退（微信公众号 #js_content 等）
 *   3. 全页面 turndown 转换（最后手段）
 *
 * 使用 turndown 将 HTML 转换为 Markdown。
 */

import TurndownService from "turndown";

// ─── 已知站点选择器配置 ─────────────────────────────────────────

/**
 * 站点模式接口
 * 定义特定网站的抓取规则
 */
interface SitePattern {
  /** 站点名称 */
  name: string;
  /** URL 匹配正则表达式 */
  urlPattern: RegExp;
  /** 内容容器的 CSS 选择器 */
  contentSelector: string;
  /** 标题的 CSS 选择器（可选） */
  titleSelector?: string;
  /** 作者的 CSS 选择器（可选） */
  authorSelector?: string;
  /**
   * 预处理函数（可选）
   * 用于修复懒加载图片等问题（如将 data-src 替换为 src）
   */
  preTransform?: (html: string) => string;
}

/**
 * 已知站点的选择器配置列表
 * 按优先级排列，支持微信公众号、知乎、掘金等站点
 */
const SITE_PATTERNS: SitePattern[] = [
  {
    name: 'WeChat',
    urlPattern: /mp\.weixin\.qq\.com/,
    contentSelector: '#js_content',
    titleSelector: '#activity-name',
    authorSelector: '#js_name',
    /** 微信公众号使用 data-src 懒加载图片，需替换为 src */
    preTransform: (html) => html.replace(/data-src=/g, 'src='),
  },
  {
    name: 'Zhihu',
    urlPattern: /zhuanlan\.zhihu\.com/,
    contentSelector: '.Post-RichTextContainer, .RichText',
    titleSelector: '.Post-Title',
    authorSelector: '.AuthorInfo-name',
  },
  {
    name: 'Juejin',
    urlPattern: /juejin\.cn/,
    contentSelector: '.article-content',
    titleSelector: '.article-title',
    authorSelector: '.username',
  },
];

// ─── 类型定义 ────────────────────────────────────────────────

/**
 * 剪藏结果接口
 * 包含从网页提取的所有结构化信息
 */
export interface ClipResult {
  /** 文章标题 */
  title: string;
  /** 作者名称 */
  author: string;
  /** Markdown 格式的正文内容 */
  content: string;
  /** 源 URL */
  url: string;
  /** 站点名称 */
  site: string;
  /** 发布日期 */
  published: string;
  /** 字数统计 */
  wordCount: number;
  /** 使用的提取方法 */
  method: 'defuddle' | 'selector' | 'turndown-fallback';
}

/**
 * 剪藏选项接口
 * 配置网页抓取行为的参数
 */
export interface ClipOptions {
  /** 目标 URL */
  url: string;
  /** 自定义内容选择器（覆盖已知站点配置） */
  selector?: string;
  /** 自定义标题（覆盖自动提取的标题） */
  title?: string;
  /** 自定义 User-Agent 字符串 */
  userAgent?: string;
}

// ─── 主入口 ───────────────────────────────────────────────────

/**
 * @description 抓取网页并转换为 Markdown
 *
 * 三层提取策略：
 * 1. defuddle：自动检测内容区域（适用于 90%+ 的网站）
 * 2. 已知选择器：针对微信公众号、知乎、掘金等特定站点
 * 3. turndown 回退：对整个页面进行 HTML→Markdown 转换
 *
 * @param opts - 剪藏选项
 * @returns 剪藏结果，包含标题、作者、Markdown 内容等
 * @throws 当 HTTP 请求失败时抛出错误
 */
export async function clipWebPage(opts: ClipOptions): Promise<ClipResult> {
  const { url, selector } = opts;
  /** 默认 User-Agent 模拟 Chrome 浏览器 */
  const userAgent = opts.userAgent ??
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  /** 获取网页 HTML */
  const resp = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
  const html = await resp.text();

  /** 第一层：尝试 defuddle 自动提取 */
  let result = await tryDefuddle(html, url);

  /** 第二层：回退到已知站点选择器 */
  if (!result || !result.content) {
    result = await tryKnownSelectors(html, url, selector);
  }

  /** 第三层：最后手段，对整个页面做 turndown 转换 */
  if (!result || !result.content) {
    result = rawTurndown(html, url);
  }

  return result;
}

// ─── 第一层：defuddle 自动提取 ────────────────────────────────────

/**
 * @description 使用 defuddle 库自动提取网页内容
 *
 * defuddle 能自动识别页面的主内容区域（类似 Readability），
 * 适用于 90% 以上的标准网页。
 *
 * @param html - 原始 HTML 字符串
 * @param url - 页面 URL
 * @returns 剪藏结果，提取失败时返回 null
 */
async function tryDefuddle(html: string, url: string): Promise<ClipResult | null> {
  try {
    /** 动态导入依赖（避免 defuddle 有问题时导致崩溃） */
    const { parseHTML } = await import('linkedom');
    const defuddleMod = await import('defuddle');
    const Defuddle = (defuddleMod as any).default ?? defuddleMod;
    const defuddleFullMod = await import('defuddle/full');
    const { createMarkdownContent } = (defuddleFullMod as any).default ?? defuddleFullMod;

    /** 解析 HTML DOM */
    const { document } = parseHTML(html);
    const defuddle = new Defuddle(document.documentElement, { url });
    const parsed = defuddle.parse();

    /** 内容过短则视为提取失败 */
    if (!parsed.content || parsed.content.length < 100) return null;

    /** 将 HTML 内容转换为 Markdown */
    const markdown = createMarkdownContent(parsed.content, url);

    return {
      title: parsed.title || '',
      author: parsed.author || '',
      content: markdown,
      url,
      site: parsed.site || '',
      published: parsed.published || '',
      wordCount: parsed.wordCount || 0,
      method: 'defuddle',
    };
  } catch {
    return null;
  }
}

// ─── 第二层：已知站点选择器 ─────────────────────────────────────

/**
 * @description 使用已知站点的 CSS 选择器提取内容
 *
 * 根据 URL 匹配已知站点配置，使用对应的选择器定位内容容器，
 * 然后通过 turndown 将 HTML 转换为 Markdown。
 *
 * @param html - 原始 HTML 字符串
 * @param url - 页面 URL
 * @param overrideSelector - 自定义选择器（可选，覆盖站点配置）
 * @returns 剪藏结果，无匹配选择器或内容过短时返回 null
 */
async function tryKnownSelectors(
  html: string,
  url: string,
  overrideSelector?: string,
): Promise<ClipResult | null> {
  const { parseHTML } = await import('linkedom');

  /** 查找匹配的站点模式 */
  const pattern = SITE_PATTERNS.find(p => p.urlPattern.test(url));

  /** 应用预处理（如修复懒加载图片） */
  const transformedHtml = pattern?.preTransform?.(html) ?? html;
  const { document } = parseHTML(transformedHtml);

  /** 确定内容选择器 */
  const contentSel = overrideSelector ?? pattern?.contentSelector;
  if (!contentSel) return null;

  /** 查找内容容器元素 */
  const contentEl = document.querySelector(contentSel);
  if (!contentEl) return null;

  /** 内容过短则视为提取失败 */
  const text = contentEl.textContent?.trim() || '';
  if (text.length < 100) return null;

  /** 提取标题 */
  const title = overrideSelector
    ? (document.querySelector('title')?.textContent?.trim() ?? '')
    : (pattern?.titleSelector
      ? (document.querySelector(pattern.titleSelector)?.textContent?.trim() ?? '')
      : (document.querySelector('title')?.textContent?.trim() ?? ''));
  /** 提取作者 */
  const author = pattern?.authorSelector
    ? (document.querySelector(pattern.authorSelector)?.textContent?.trim() ?? '')
    : '';

  /** 使用 turndown 将 HTML 内容转换为 Markdown */
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const markdown = td.turndown(contentEl.innerHTML);

  return {
    title,
    author,
    content: markdown,
    url,
    site: pattern?.name ?? new URL(url).hostname,
    published: '',
    wordCount: text.length,
    method: 'selector',
  };
}

// ─── 第三层：全页面 turndown 转换 ───────────────────────────────

/**
 * @description 对整个页面执行 HTML→Markdown 转换（最后手段）
 *
 * 直接对完整 HTML 使用 turndown 转换，从 <title> 标签提取标题。
 * 结果可能包含导航栏、页脚等非正文内容。
 *
 * @param html - 原始 HTML 字符串
 * @param url - 页面 URL
 * @returns 剪藏结果
 */
function rawTurndown(html: string, url: string): ClipResult {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const markdown = td.turndown(html);

  /** 从 <title> 标签提取标题 */
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? '';

  return {
    title,
    author: '',
    content: markdown,
    url,
    site: new URL(url).hostname,
    published: '',
    wordCount: markdown.length,
    method: 'turndown-fallback',
  };
}
