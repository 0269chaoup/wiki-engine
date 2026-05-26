/**
 * Web clipper — fetch URL → extract content → markdown
 *
 * Two-layer extraction:
 *   1. defuddle (auto-detect content for 90%+ sites)
 *   2. Known selectors fallback (WeChat #js_content, etc.)
 *
 * Then turndown converts HTML → markdown.
 */

import TurndownService from "turndown";

// ─── Known site selectors ─────────────────────────────────────────

interface SitePattern {
  name: string;
  /** Regex to match URL */
  urlPattern: RegExp;
  /** CSS selector for content container */
  contentSelector: string;
  /** CSS selector for title (optional) */
  titleSelector?: string;
  /** CSS selector for author (optional) */
  authorSelector?: string;
  /** Pre-transform: fix lazy-load images etc. */
  preTransform?: (html: string) => string;
}

const SITE_PATTERNS: SitePattern[] = [
  {
    name: 'WeChat',
    urlPattern: /mp\.weixin\.qq\.com/,
    contentSelector: '#js_content',
    titleSelector: '#activity-name',
    authorSelector: '#js_name',
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

// ─── Types ────────────────────────────────────────────────────────

export interface ClipResult {
  title: string;
  author: string;
  content: string;   // markdown body
  url: string;
  site: string;
  published: string;
  wordCount: number;
  method: 'defuddle' | 'selector' | 'turndown-fallback';
}

export interface ClipOptions {
  url: string;
  /** Override content selector */
  selector?: string;
  /** Override title */
  title?: string;
  /** User-Agent string */
  userAgent?: string;
}

// ─── Main entry ───────────────────────────────────────────────────

export async function clipWebPage(opts: ClipOptions): Promise<ClipResult> {
  const { url, selector } = opts;
  const userAgent = opts.userAgent ??
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // Fetch HTML
  const resp = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
  const html = await resp.text();

  // Try defuddle first
  let result = await tryDefuddle(html, url);

  // Fallback to known selectors
  if (!result || !result.content) {
    result = await tryKnownSelectors(html, url, selector);
  }

  // Last resort: raw turndown on body
  if (!result || !result.content) {
    result = rawTurndown(html, url);
  }

  return result;
}

// ─── Layer 1: defuddle ────────────────────────────────────────────

async function tryDefuddle(html: string, url: string): Promise<ClipResult | null> {
  try {
    // Dynamic import to avoid crash if defuddle has issues
    const { parseHTML } = await import('linkedom');
    const defuddleMod = await import('defuddle');
    const Defuddle = (defuddleMod as any).default ?? defuddleMod;
    const defuddleFullMod = await import('defuddle/full');
    const { createMarkdownContent } = (defuddleFullMod as any).default ?? defuddleFullMod;

    const { document } = parseHTML(html);
    const defuddle = new Defuddle(document.documentElement, { url });
    const parsed = defuddle.parse();

    if (!parsed.content || parsed.content.length < 100) return null;

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

// ─── Layer 2: known selectors ─────────────────────────────────────

async function tryKnownSelectors(
  html: string,
  url: string,
  overrideSelector?: string,
): Promise<ClipResult | null> {
  const { parseHTML } = await import('linkedom');

  // Find matching site pattern
  const pattern = SITE_PATTERNS.find(p => p.urlPattern.test(url));

  // Apply pre-transform
  const transformedHtml = pattern?.preTransform?.(html) ?? html;
  const { document } = parseHTML(transformedHtml);

  // Determine selectors
  const contentSel = overrideSelector ?? pattern?.contentSelector;
  if (!contentSel) return null;

  const contentEl = document.querySelector(contentSel);
  if (!contentEl) return null;

  const text = contentEl.textContent?.trim() || '';
  if (text.length < 100) return null;

  // Extract title & author
  const title = overrideSelector
    ? (document.querySelector('title')?.textContent?.trim() ?? '')
    : (pattern?.titleSelector
      ? (document.querySelector(pattern.titleSelector)?.textContent?.trim() ?? '')
      : (document.querySelector('title')?.textContent?.trim() ?? ''));
  const author = pattern?.authorSelector
    ? (document.querySelector(pattern.authorSelector)?.textContent?.trim() ?? '')
    : '';

  // Convert to markdown
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

// ─── Layer 3: raw turndown fallback ───────────────────────────────

function rawTurndown(html: string, url: string): ClipResult {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const markdown = td.turndown(html);

  // Extract title from <title> tag
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
