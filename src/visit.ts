import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import puppeteer, { Browser, Page, ElementHandle, KeyInput } from 'puppeteer';

type Article = {
  title: string;
  url: string;
  author: string;
};

type CardPageSummary = {
  url: string;
  pageTitle: string;
  foundAnyContent: boolean;
  cardTexts: string[];
  cardLinks: string[];
};

type DetailTarget = {
  url: string;
  title?: string;
};

type DetailPage = {
  url: string;
  title: string;
  content: string;
};

type Quote = {
  text: string;
  url: string;
  title: string;
};

type DraftArticle = {
  title: string;
  body: string;
  raw: string;
  prompt: string;
  quotes: Quote[];
  tags?: string[];
  thumbnailPath?: string;
};

function stripEnvQuotes(value: string): string {
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  try {
    const content = readFileSync(envPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const withoutExport = trimmed.startsWith('export ')
        ? trimmed.slice('export '.length).trim()
        : trimmed;
      const eqIndex = withoutExport.indexOf('=');
      if (eqIndex < 0) continue;
      const key = withoutExport.slice(0, eqIndex).trim();
      if (!key) continue;
      const valueRaw = withoutExport.slice(eqIndex + 1).trim();
      const value = stripEnvQuotes(valueRaw);
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn('Failed to load .env:', err);
  }
}

function readEnvValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

loadDotEnv();

/* =========================
 * env
 * ========================= */
const rawTargetEnv = process.env.TARGET_URL?.trim();
const rawTargetsEnv = process.env.TARGET_URLS?.trim();
const defaultTargetUrls = buildDefaultTargetUrls();
const screenshotPath =
  process.env.SCREENSHOT_PATH?.trim() ||
  path.join(process.cwd(), 'data', 'page.png');
const htmlDumpPath =
  process.env.HTML_DUMP_PATH?.trim() ||
  path.join(process.cwd(), 'data', 'page.html');
const articlesJsonPath = process.env.ARTICLES_JSON?.trim();
const maxArticles = parsePositiveInt(process.env.MAX_ARTICLES);
const cardClassName =
  process.env.CARD_CLASS?.trim() || 'm-largeNoteWrapper__card';
const cardTextsJsonPath =
  process.env.CARD_TEXTS_JSON?.trim() ||
  path.join(process.cwd(), 'data', 'card-texts.json');
const detailPagesJsonPath =
  process.env.DETAIL_PAGES_JSON?.trim() ||
  path.join(process.cwd(), 'detail-pages.json');
const generateArticle = parseBoolean(process.env.GENERATE_ARTICLE);
const articleCharTarget = parsePositiveInt(process.env.ARTICLE_CHAR_TARGET) ?? 4000;
const articleCharMaxRaw = parsePositiveInt(process.env.ARTICLE_CHAR_MAX) ?? 5000;
const articleCharMax = Math.max(articleCharTarget, articleCharMaxRaw);
const articleInstruction = process.env.ARTICLE_INSTRUCTION?.trim();
const articleOutputMarkdown = parseOptionalBoolean(
  process.env.ARTICLE_OUTPUT_MARKDOWN,
  true
);
const postTitleOverride = process.env.POST_TITLE?.trim();
const postBodyOverride = process.env.POST_BODY?.trim();
const postBodyFile = process.env.POST_BODY_FILE?.trim();
const postTagsOverride = process.env.POST_TAGS?.trim();
const postThumbnailPath = process.env.POST_THUMBNAIL_PATH?.trim();
const postParseFrontMatter = parseOptionalBoolean(
  process.env.POST_PARSE_FRONTMATTER,
  true
);
const generatedArticlePath =
  process.env.GENERATED_ARTICLE_PATH?.trim() ||
  path.join(process.cwd(), 'data', 'generated-article.txt');
const quoteLimit = parsePositiveInt(process.env.QUOTE_LIMIT) ?? 6;
const quotePerPageLimit = parsePositiveInt(process.env.QUOTE_PER_PAGE_LIMIT) ?? 2;
const quoteMinLength = parsePositiveInt(process.env.QUOTE_MIN_LENGTH) ?? 30;
const quoteMaxLength = parsePositiveInt(process.env.QUOTE_MAX_LENGTH) ?? 220;
const autoHeadings = parseOptionalBoolean(process.env.AUTO_HEADINGS, true);
const autoHeadingMinParagraphs =
  parsePositiveInt(process.env.AUTO_HEADING_MIN_PARAGRAPHS) ?? 3;
const autoHeadingParagraphTarget =
  parsePositiveInt(process.env.AUTO_HEADING_PARAGRAPH_TARGET) ?? 200;
const h2Every = parsePositiveInt(process.env.H2_EVERY) ?? 3;
const h3Every = parsePositiveInt(process.env.H3_EVERY) ?? 2;
const h2Prefix = process.env.H2_PREFIX?.trim() || '見出し';
const h3Prefix = process.env.H3_PREFIX?.trim() || 'ポイント';
const context7Command = process.env.CONTEXT7_COMMAND?.trim();
const context7ApiUrl = process.env.CONTEXT7_API_URL?.trim();
const defaultContext7Command =
  process.env.DEFAULT_CONTEXT7_COMMAND?.trim() || 'context7';
const resolvedContext7Command = context7ApiUrl
  ? undefined
  : context7Command || defaultContext7Command;
const context7ApiKey = process.env.CONTEXT7_API_KEY?.trim();
const context7Model = process.env.CONTEXT7_MODEL?.trim();
const context7TimeoutMs = parsePositiveInt(process.env.CONTEXT7_TIMEOUT_MS) ?? 60000;
const detailPageLimitEnv = parsePositiveInt(process.env.DETAIL_PAGE_LIMIT);
const detailPageLimit = detailPageLimitEnv ?? (generateArticle ? 5 : 1);
const loginEmail = readEnvValue('LOGIN_EMAIL', 'EMAIL');
const loginPassword = readEnvValue('LOGIN_PASSWORD', 'PASSWORD');
const loginUrl = process.env.LOGIN_URL?.trim() || 'https://note.com/login';
const loginTimeoutMs = parsePositiveInt(process.env.LOGIN_TIMEOUT_MS) ?? 45000;
const openPostPageEnv = process.env.OPEN_POST_PAGE;
const openPostPage =
  openPostPageEnv !== undefined
    ? parseBoolean(openPostPageEnv)
    : generateArticle || Boolean(postBodyOverride || postBodyFile);
const keepBrowserOpen = parseBoolean(process.env.KEEP_BROWSER_OPEN);
const fillPostTitle = parseOptionalBoolean(process.env.POST_FILL_TITLE, true);
const fillPostBody = parseOptionalBoolean(process.env.POST_FILL_BODY, true);
const pauseAfterPost =
  parseBoolean(process.env.PAUSE_AFTER_POST) || keepBrowserOpen;
const pauseAfterPostMs = parsePositiveInt(process.env.PAUSE_AFTER_POST_MS) ?? 0;
const rawPostPageUrls = process.env.POST_PAGE_URLS?.trim();
const postPageUrl = process.env.POST_PAGE_URL?.trim();
const postPageUrls = buildPostPageUrls();
const postClickSelector = process.env.POST_CLICK_SELECTOR?.trim();
const postClickText = process.env.POST_CLICK_TEXT?.trim();
const postAction = process.env.POST_ACTION?.trim() || 'draft';
const postActionNormalized = postAction ? postAction.toLowerCase() : undefined;
const postClickTimeoutMs =
  parsePositiveInt(process.env.POST_CLICK_TIMEOUT_MS) ?? loginTimeoutMs;
const inputDelayMs = parsePositiveInt(process.env.INPUT_DELAY_MS) ?? 15;
const inputChunkSize = parsePositiveInt(process.env.INPUT_CHUNK_SIZE) ?? 80;
const postUseMarkdownShortcuts = parseOptionalBoolean(
  process.env.POST_USE_MARKDOWN_SHORTCUTS,
  true
);
const postParseInlineStyles = parseOptionalBoolean(
  process.env.POST_PARSE_INLINE_STYLES,
  true
);
const dialogAction =
  process.env.DIALOG_ACTION?.trim().toLowerCase() === 'accept'
    ? 'accept'
    : 'dismiss';
const postTags = parseListFromEnv(postTagsOverride);
const defaultTags = buildDefaultTags();
const postActionTexts = buildPostActionTexts();

const headless = process.env.HEADLESS !== 'false';
const executablePath = process.env.CHROME_PATH?.trim();
const defaultUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const persistSession = parseOptionalBoolean(process.env.PERSIST_SESSION, false);
const userDataDir = process.env.USER_DATA_DIR?.trim();

const detailBodySelectors = [
  'div[data-name="body"]',
  'div.note-common-styles__textnote-body',
  'div.note-common-styles__richtext',
  '[data-testid="textnote-body"]',
];
const detailContentSelectors = [
  ...detailBodySelectors,
  'article',
  'main',
  '[role="main"]',
];

const postTitleSelectors = [
  'textarea[placeholder="記事タイトル"]',
  'textarea[placeholder*="タイトル"]',
  'input[placeholder*="タイトル"]',
  '[data-testid*="title"] textarea',
  '[data-testid*="title"] input',
  '[name*="title"]',
];
const postBodySelectors = [
  'div.ProseMirror[contenteditable="true"]',
  'div.ProseMirror',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
];
const postTagSelectors = [
  'input[placeholder*="タグ"]',
  'input[placeholder*="tag"]',
  '[data-testid*="tag"] input',
  'input[name*="tag"]',
];
const postThumbnailInputSelectors = [
  'input[type="file"][accept*="image"]',
  'input[type="file"][accept*="png"]',
  'input[type="file"]',
];
const postThumbnailButtonTexts = ['見出し画像', 'サムネイル', 'アイキャッチ', '画像を追加'];

/* =========================
 * util
 * ========================= */
function parsePositiveInt(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseBoolean(value?: string): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'y' ||
    normalized === 'on'
  );
}

function parseOptionalBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return parseBoolean(value);
}

function parseTargetList(raw: string): string[] {
  const parts = raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const results: string[] = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    results.push(part);
  }
  return results;
}

function parseListFromEnv(raw?: string): string[] {
  if (!raw) return [];
  return parseTargetList(raw);
}

function buildDefaultTargetUrls(): string[] {
  const rawDefaults = process.env.DEFAULT_TARGET_URLS?.trim();
  if (rawDefaults) {
    const parsed = parseTargetList(rawDefaults);
    if (parsed.length > 0) return parsed;
  }
  return [
    'https://note.com/topic/computer_it',
    'https://note.com/topic/science_technology',
  ];
}

function buildDefaultTags(): string[] {
  const rawDefaults = process.env.DEFAULT_TAGS?.trim();
  if (rawDefaults) {
    if (rawDefaults.toLowerCase() === 'none') return [];
    const parsed = parseTargetList(rawDefaults);
    if (parsed.length > 0) return parsed;
  }
  return ['IT'];
}

function buildPostPageUrls(): string[] {
  const defaults = [
    'https://editor.note.com/new',
    'https://editor.note.com/notes/new',
    'https://note.com/notes/new',
  ];
  const candidates = [
    ...(postPageUrl ? [postPageUrl] : []),
    ...(rawPostPageUrls ? parseTargetList(rawPostPageUrls) : []),
    ...defaults,
  ];
  const seen = new Set<string>();
  const results: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    results.push(trimmed);
  }
  return results;
}

function buildPostActionTexts(): string[] {
  const texts: string[] = [];
  if (postClickText) {
    texts.push(...parseTargetList(postClickText));
  }
  if (postActionNormalized === 'draft') {
    texts.push('下書き保存', '下書きに保存', '保存');
  } else if (
    postActionNormalized === 'publish' ||
    postActionNormalized === 'public'
  ) {
    texts.push('公開に進む', '公開', '投稿する');
  } else if (postActionNormalized === 'none' || postActionNormalized === 'off') {
    // no-op
  }
  const seen = new Set<string>();
  const results: string[] = [];
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    results.push(trimmed);
  }
  return results;
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseInlineArray(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((part) => stripOuterQuotes(part.trim()))
    .filter(Boolean);
}

function parseFrontMatterValue(value: string): string | string[] {
  const inlineArray = parseInlineArray(value);
  if (inlineArray) return inlineArray;
  return stripOuterQuotes(value.trim());
}

function parseFrontMatter(content: string): {
  attributes: Record<string, string | string[]>;
  body: string;
} {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { attributes: {}, body: content };
  }
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { attributes: {}, body: content };
  }
  const rawMatter = match[1];
  const body = normalized.slice(match[0].length);
  const attributes: Record<string, string | string[]> = {};
  const lines = rawMatter.split('\n');
  let currentKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const listMatch = trimmed.match(/^-\\s+(.*)$/);
    if (listMatch && currentKey) {
      const existing = attributes[currentKey];
      const values = Array.isArray(existing) ? existing : [];
      values.push(stripOuterQuotes(listMatch[1].trim()));
      attributes[currentKey] = values.filter(Boolean);
      continue;
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+)\\s*:\\s*(.*)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const rawValue = keyMatch[2];
    if (!rawValue) {
      currentKey = key;
      attributes[key] = [];
      continue;
    }
    currentKey = key;
    attributes[key] = parseFrontMatterValue(rawValue);
  }

  return { attributes, body };
}

function normalizeStringArray(
  value?: string | string[]
): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => v.trim()).filter(Boolean);
  }
  const trimmed = value.trim();
  if (!trimmed) return [];
  return parseTargetList(trimmed);
}

function extractTagsFromAttributes(
  attributes: Record<string, string | string[]>
): string[] {
  return normalizeStringArray(
    attributes.tags ?? attributes.tag ?? attributes.categories
  );
}

function extractTitleFromAttributes(
  attributes: Record<string, string | string[]>
): string | undefined {
  const value = attributes.title ?? attributes.name;
  if (Array.isArray(value)) {
    return value[0]?.trim();
  }
  return value?.trim() || undefined;
}

function extractThumbnailFromAttributes(
  attributes: Record<string, string | string[]>
): string | undefined {
  const value =
    attributes.thumbnail ??
    attributes.eyecatch ??
    attributes.cover ??
    attributes.image ??
    attributes.thumbnail_path ??
    attributes.thumbnailPath;
  if (Array.isArray(value)) {
    return value[0];
  }
  return value?.trim() || undefined;
}

async function resolveTargetUrl(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed) || /^file:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // ローカルファイルパスとして解釈（例: TARGET_URL=./data/sample.html）
  const maybePath = path.isAbsolute(trimmed)
    ? trimmed
    : path.join(process.cwd(), trimmed);

  try {
    const stat = await fs.stat(maybePath);
    if (stat.isFile()) {
      return pathToFileURL(maybePath).toString();
    }
  } catch {
    // ignore
  }

  return trimmed;
}

const autoScroll = async (page: Page, maxScrollCount = 5): Promise<void> => {
  for (let i = 0; i < maxScrollCount; i++) {
    await page.evaluate(() => {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth',
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LineKind = 'empty' | 'heading' | 'ul' | 'ol' | 'quote' | 'paragraph';

function classifyLine(line: string): LineKind {
  const trimmed = line.trim();
  if (!trimmed) return 'empty';
  const leading = line.trimStart();
  if (/^#{1,6}\s+/.test(leading)) return 'heading';
  if (/^-\s+/.test(leading) || /^\*\s+/.test(leading) || /^\+\s+/.test(leading)) {
    return 'ul';
  }
  if (/^\d+\.\s+/.test(leading)) return 'ol';
  if (/^>\s+/.test(leading)) return 'quote';
  return 'paragraph';
}

type BlockKind = 'paragraph' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'code';

type InlineStyleState = {
  bold: boolean;
  strike: boolean;
};

type InlineSegment = InlineStyleState & {
  text: string;
};

function isCodeFence(line: string): boolean {
  return /^```/.test(line.trim());
}

function parseBlockLine(
  line: string,
  inCodeBlock: boolean
): { kind: BlockKind; text: string } {
  if (inCodeBlock) {
    return { kind: 'code', text: line };
  }
  const trimmedStart = line.trimStart();
  if (/^###\s+/.test(trimmedStart)) {
    return { kind: 'h3', text: trimmedStart.replace(/^###\s+/, '') };
  }
  if (/^#{1,2}\s+/.test(trimmedStart)) {
    return { kind: 'h2', text: trimmedStart.replace(/^#{1,2}\s+/, '') };
  }
  if (/^>\s+/.test(trimmedStart)) {
    return { kind: 'quote', text: trimmedStart.replace(/^>\s+/, '') };
  }
  if (/^\d+\.\s+/.test(trimmedStart)) {
    return { kind: 'ol', text: trimmedStart.replace(/^\d+\.\s+/, '') };
  }
  if (/^[-*+]\s+/.test(trimmedStart)) {
    return { kind: 'ul', text: trimmedStart.replace(/^[-*+]\s+/, '') };
  }
  return { kind: 'paragraph', text: line };
}

function parseInlineSegments(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let bold = false;
  let strike = false;
  let buffer = '';

  const flush = () => {
    if (!buffer) return;
    segments.push({ text: buffer, bold, strike });
    buffer = '';
  };

  for (let i = 0; i < line.length; ) {
    if (line.startsWith('**', i)) {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    if (line.startsWith('~~', i)) {
      flush();
      strike = !strike;
      i += 2;
      continue;
    }
    buffer += line[i];
    i += 1;
  }
  flush();
  return segments;
}

async function pressShortcut(page: Page, keys: string[]): Promise<void> {
  const modifiers = keys.slice(0, -1);
  const key = keys[keys.length - 1];
  for (const mod of modifiers) {
    await page.keyboard.down(mod as KeyInput);
  }
  await page.keyboard.press(key as KeyInput);
  for (const mod of modifiers.reverse()) {
    await page.keyboard.up(mod as KeyInput);
  }
}

async function applyBlockShortcut(
  page: Page,
  kind: BlockKind
): Promise<void> {
  const commandKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  switch (kind) {
    case 'paragraph':
      await pressShortcut(page, [commandKey, 'Alt', 'Digit0']);
      return;
    case 'h2':
      await pressShortcut(page, [commandKey, 'Alt', 'Digit2']);
      return;
    case 'h3':
      await pressShortcut(page, [commandKey, 'Alt', 'Digit3']);
      return;
    case 'ul':
      await pressShortcut(page, [commandKey, 'Shift', 'Digit8']);
      return;
    case 'ol':
      await pressShortcut(page, [commandKey, 'Shift', 'Digit7']);
      return;
    case 'quote':
      await pressShortcut(page, ['Control', 'Shift', 'Period']);
      return;
    case 'code':
      await pressShortcut(page, [commandKey, 'Alt', 'Backslash']);
      return;
    default:
      return;
  }
}

async function applyInlineStyles(
  page: Page,
  current: InlineStyleState,
  next: InlineStyleState
): Promise<InlineStyleState> {
  const commandKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  let state = { ...current };
  if (state.bold !== next.bold) {
    await pressShortcut(page, [commandKey, 'KeyB']);
    state.bold = !state.bold;
  }
  if (state.strike !== next.strike) {
    await pressShortcut(page, [commandKey, 'Shift', 'KeyX']);
    state.strike = !state.strike;
  }
  return state;
}

async function typeLineWithInlineStyles(params: {
  page: Page;
  line: string;
  delayMs: number;
  parseInline: boolean;
}): Promise<void> {
  const { page, line, delayMs, parseInline } = params;
  if (!parseInline) {
    if (line.length > 0) {
      await page.keyboard.type(line, { delay: delayMs });
    }
    return;
  }

  const segments = parseInlineSegments(line);
  let state: InlineStyleState = { bold: false, strike: false };
  for (const segment of segments) {
    state = await applyInlineStyles(page, state, segment);
    if (segment.text.length > 0) {
      await page.keyboard.type(segment.text, { delay: delayMs });
    }
  }
  // reset inline styles
  state = await applyInlineStyles(page, state, { bold: false, strike: false });
}

async function typeBodyWithShortcuts(params: {
  page: Page;
  body: string;
  delayMs: number;
}): Promise<void> {
  const { page, body, delayMs } = params;
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let inCodeBlock = false;
  let currentBlock: BlockKind = 'paragraph';

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';

    if (isCodeFence(rawLine)) {
      if (!inCodeBlock) {
        await applyBlockShortcut(page, 'code');
        inCodeBlock = true;
        currentBlock = 'code';
      } else {
        await applyBlockShortcut(page, 'code');
        inCodeBlock = false;
        currentBlock = 'paragraph';
      }
      continue;
    }

    if (!rawLine.trim() && !inCodeBlock) {
      await page.keyboard.press('Enter');
      currentBlock = 'paragraph';
      continue;
    }

    const { kind, text } = parseBlockLine(rawLine, inCodeBlock);
    const nextKind = inCodeBlock
      ? 'code'
      : parseBlockLine(nextLine, false).kind;

    if (kind !== currentBlock) {
      await applyBlockShortcut(page, kind);
      currentBlock = kind;
    }

    await typeLineWithInlineStyles({
      page,
      line: text,
      delayMs,
      parseInline: postParseInlineStyles && kind !== 'code',
    });

    await page.keyboard.press('Enter');

    if ((kind === 'ul' || kind === 'ol' || kind === 'quote') && nextKind !== kind) {
      await page.keyboard.press('Enter');
      currentBlock = 'paragraph';
    }

    if (delayMs > 0) {
      await sleep(Math.min(200, delayMs * 2));
    }
  }
}

async function saveDebugArtifacts(page: Page, reason: string): Promise<void> {
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(htmlDumpPath), { recursive: true });

  const safeReason = reason.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'debug';
  const screenshotOut = screenshotPath.replace(
    /(\.[a-z0-9]+)$/i,
    `.${safeReason}$1`
  );
  const htmlOut = htmlDumpPath.replace(/(\.[a-z0-9]+)$/i, `.${safeReason}$1`);

  try {
    await page.screenshot({ path: screenshotOut, fullPage: true });
    console.log(`Saved screenshot: ${screenshotOut}`);
  } catch (e) {
    console.warn('Failed to save screenshot:', e);
  }

  try {
    const html = await page.content();
    await fs.writeFile(htmlOut, html, 'utf-8');
    console.log(`Saved HTML dump: ${htmlOut}`);
  } catch (e) {
    console.warn('Failed to save HTML dump:', e);
  }
}

async function saveArticlesJson(params: {
  pages: Array<{
    url: string;
    pageTitle: string;
    foundAnyContent: boolean;
    articles: Article[];
  }>;
}): Promise<void> {
  if (!articlesJsonPath) return;
  if (params.pages.length === 0) return;
  const fetchedAt = new Date().toISOString();
  const payload =
    params.pages.length === 1
      ? {
          url: params.pages[0].url,
          pageTitle: params.pages[0].pageTitle,
          fetchedAt,
          foundAnyContent: params.pages[0].foundAnyContent,
          count: params.pages[0].articles.length,
          articles: params.pages[0].articles,
        }
      : {
          fetchedAt,
          totalCount: params.pages.reduce(
            (sum, page) => sum + page.articles.length,
            0
          ),
          pages: params.pages.map((page) => ({
            url: page.url,
            pageTitle: page.pageTitle,
            foundAnyContent: page.foundAnyContent,
            count: page.articles.length,
            articles: page.articles,
          })),
        };

  try {
    await fs.mkdir(path.dirname(articlesJsonPath), { recursive: true });
    await fs.writeFile(
      articlesJsonPath,
      JSON.stringify(payload, null, 2),
      'utf-8'
    );
    console.log(`Saved articles JSON: ${articlesJsonPath}`);
  } catch (err) {
    console.warn('Failed to save articles JSON:', err);
  }
}

async function saveCardTextsJson(params: {
  className: string;
  pages: CardPageSummary[];
  uniqueLinks: string[];
}): Promise<void> {
  if (params.pages.length === 0) return;
  const fetchedAt = new Date().toISOString();
  const payload =
    params.pages.length === 1
      ? {
          url: params.pages[0].url,
          pageTitle: params.pages[0].pageTitle,
          fetchedAt,
          className: params.className,
          count: params.pages[0].cardTexts.length,
          texts: params.pages[0].cardTexts,
          linkCount: params.pages[0].cardLinks.length,
          links: params.pages[0].cardLinks,
        }
      : {
          fetchedAt,
          className: params.className,
          targets: params.pages.map((page) => page.url),
          uniqueLinkCount: params.uniqueLinks.length,
          uniqueLinks: params.uniqueLinks,
          pages: params.pages.map((page) => ({
            url: page.url,
            pageTitle: page.pageTitle,
            foundAnyContent: page.foundAnyContent,
            cardTextCount: page.cardTexts.length,
            cardTexts: page.cardTexts,
            cardLinkCount: page.cardLinks.length,
            cardLinks: page.cardLinks,
          })),
        };

  try {
    await fs.mkdir(path.dirname(cardTextsJsonPath), { recursive: true });
    await fs.writeFile(
      cardTextsJsonPath,
      JSON.stringify(payload, null, 2),
      'utf-8'
    );
    console.log(`Saved card texts JSON: ${cardTextsJsonPath}`);
  } catch (err) {
    console.warn('Failed to save card texts JSON:', err);
  }
}

async function saveDetailPagesJson(pages: DetailPage[]): Promise<void> {
  if (pages.length === 0) return;
  try {
    await fs.mkdir(path.dirname(detailPagesJsonPath), { recursive: true });
    await fs.writeFile(
      detailPagesJsonPath,
      JSON.stringify(pages, null, 2),
      'utf-8'
    );
    console.log(`Saved detail pages JSON: ${detailPagesJsonPath}`);
  } catch (err) {
    console.warn('Failed to save detail pages JSON:', err);
  }
}

async function isLoginPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const loginMain = document.querySelector('main.o-login');
    const email = document.querySelector('#email');
    const password = document.querySelector('#password');
    return Boolean(loginMain || (email && password));
  });
}

async function hasVisibleRecaptcha(page: Page): Promise<boolean> {
  const script = `(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const element = el;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const recaptcha = document.querySelector('.g-recaptcha');
    const iframe = document.querySelector('iframe[title="reCAPTCHA"]');
    return isVisible(recaptcha) || isVisible(iframe);
  })()`;
  const result = await page.evaluate(script);
  return Boolean(result);
}

async function setInputValue(
  page: Page,
  selector: string,
  value: string,
  timeoutMs: number
): Promise<void> {
  await page.waitForSelector(selector, { timeout: timeoutMs });
  await page.evaluate(
    ({ selector, value }) => {
      const input = document.querySelector<HTMLInputElement>(selector);
      if (!input) return;
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { selector, value }
  );
}

async function submitLoginForm(params: {
  page: Page;
  email: string;
  password: string;
  timeoutMs: number;
}): Promise<boolean> {
  const { page, email, password, timeoutMs } = params;
  await setInputValue(page, '#email', email, timeoutMs);
  await setInputValue(page, '#password', password, timeoutMs);

  const loginButtonSelector = 'main.o-login .o-login__button button';
  await page.waitForSelector(loginButtonSelector, { timeout: timeoutMs });
  await page.click(loginButtonSelector);

  const loginPageGone = await page
    .waitForFunction(() => !document.querySelector('main.o-login'), {
      timeout: timeoutMs,
    })
    .then(() => true)
    .catch(() => false);

  if (loginPageGone) return true;

  if (await hasVisibleRecaptcha(page)) {
    console.warn(
      'reCAPTCHA detected. Set HEADLESS=false and complete it manually.'
    );
  }
  return false;
}

async function ensureLoggedIn(params: {
  page: Page;
  email: string;
  password: string;
  loginUrl: string;
  timeoutMs: number;
}): Promise<boolean> {
  const { page, email, password, loginUrl, timeoutMs } = params;

  console.log(`Accessing login page: ${loginUrl}`);
  await page.goto(loginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('body');

  const isLogin = await isLoginPage(page);
  if (!isLogin) {
    console.log('Login page not detected. Assuming already logged in.');
    return true;
  }

  const success = await submitLoginForm({
    page,
    email,
    password,
    timeoutMs,
  });
  if (success) {
    console.log('Login completed.');
  }
  return success;
}

async function isPostComposerPage(page: Page): Promise<boolean> {
  return page
    .evaluate((titleSelectors, bodySelectors) => {
      const hasVisible = (selectors: string[]): boolean => {
        return selectors.some((selector) => {
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      };
      return hasVisible(titleSelectors) && hasVisible(bodySelectors);
    }, postTitleSelectors, postBodySelectors)
    .catch(() => false);
}

async function waitForPostComposerReady(
  page: Page,
  timeoutMs: number
): Promise<boolean> {
  const titleHandleInfo = await findFirstVisibleHandle(
    page,
    postTitleSelectors,
    timeoutMs
  );
  const bodyHandleInfo = await findFirstVisibleHandle(
    page,
    postBodySelectors,
    timeoutMs
  );
  if (titleHandleInfo) {
    await titleHandleInfo.handle.dispose().catch(() => {});
  }
  if (bodyHandleInfo) {
    await bodyHandleInfo.handle.dispose().catch(() => {});
  }
  return Boolean(titleHandleInfo && bodyHandleInfo);
}

async function openPostComposer(params: {
  page: Page;
  postPageUrls: string[];
  timeoutMs: number;
}): Promise<Page | null> {
  const { page, postPageUrls, timeoutMs } = params;
  const browser = page.browser();
  const candidates = postPageUrls.length > 0 ? postPageUrls : ['https://editor.note.com/new'];
  const postButtonSelector =
    'a[href="/notes/new"], a[href^="/notes/new?"], a[href="/new"], a[href^="/new?"]';

  const isNonFatalNavError = (err: unknown): boolean => {
    if (!err) return false;
    const message = String(err);
    return (
      message.includes('ERR_ABORTED') ||
      message.includes('Navigation timeout')
    );
  };

  const gotoSafe = async (url: string): Promise<void> => {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    } catch (err) {
      if (!isNonFatalNavError(err)) throw err;
    }
    await page.waitForSelector('body').catch(() => {});
  };

  for (const rawPostPageUrl of candidates) {
    let resolvedPostPageUrl = rawPostPageUrl;
    try {
      resolvedPostPageUrl = new URL(rawPostPageUrl).href;
    } catch {
      resolvedPostPageUrl = new URL(rawPostPageUrl, 'https://note.com/').href;
    }

    const baseUrl = new URL('/', resolvedPostPageUrl).href;
    await gotoSafe(baseUrl);

    if (await isLoginPage(page)) {
      console.warn('Login page detected while opening the post composer.');
      return null;
    }

    if (await waitForPostComposerReady(page, Math.min(timeoutMs, 12000))) {
      return page;
    }

    const postButton = await page
      .waitForSelector(postButtonSelector, { timeout: Math.min(timeoutMs, 8000) })
      .catch(() => null);
    if (postButton) {
      const navigationPromise = page
        .waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        })
        .catch(() => null);
      await page.click(postButtonSelector);
      await navigationPromise;
      if (await waitForPostComposerReady(page, Math.min(timeoutMs, 12000))) {
        return page;
      }
    }

    await gotoSafe(resolvedPostPageUrl);
    if (await waitForPostComposerReady(page, timeoutMs)) return page;
  }

  const newTarget = await browser
    .waitForTarget(
      (target) =>
        target.type() === 'page' &&
        (target.url().includes('/notes/new') || target.url().includes('/new')),
      { timeout: timeoutMs }
    )
    .catch(() => null);
  const newPage = newTarget ? await newTarget.page() : null;
  if (newPage) {
    attachDialogHandler(newPage);
    await newPage
      .setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
      .catch(() => {});
    await newPage.setUserAgent(defaultUserAgent).catch(() => {});
    await newPage
      .setExtraHTTPHeaders({
        'Accept-Language': 'ja-JP,ja;q=0.9',
      })
      .catch(() => {});
    await newPage.waitForSelector('body').catch(() => {});
    if (await waitForPostComposerReady(newPage, timeoutMs)) return newPage;
  }

  return null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasMarkdownHeadings(body: string): boolean {
  return /(^|\n)\s*#{2,3}\s+\S/.test(body);
}

function buildParagraphsFromSentences(
  sentences: string[],
  targetLength: number
): string[] {
  const paragraphs: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer}${sentence}` : sentence;
    if (buffer && candidate.length >= targetLength) {
      paragraphs.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer = candidate;
    }
  }

  if (buffer.trim()) paragraphs.push(buffer.trim());
  return paragraphs;
}

function splitParagraphs(body: string, targetLength: number): string[] {
  const normalized = body.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const parts = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) return parts;

  const sentenceRegex = /[^。.!?！？]+[。.!?！？]+|[^。.!?！？]+$/g;
  const sentences = normalized.match(sentenceRegex);
  if (!sentences || sentences.length <= 1) return [normalized];

  return buildParagraphsFromSentences(sentences, targetLength);
}

function applyAutoHeadings(body: string): string {
  if (!autoHeadings) return body;
  if (!body.trim()) return body;
  if (hasMarkdownHeadings(body)) return body;

  const paragraphs = splitParagraphs(body, autoHeadingParagraphTarget);
  if (paragraphs.length < autoHeadingMinParagraphs) return body;

  const safeH2Every = Math.max(1, Math.floor(h2Every));
  const safeH3Every = Math.max(0, Math.floor(h3Every));
  const safeH2Prefix = h2Prefix || 'Section';
  const safeH3Prefix = h3Prefix || 'Point';
  const lines: string[] = [];
  let h2Index = 1;
  let h3Index = 1;

  for (let i = 0; i < paragraphs.length; i += 1) {
    const isSectionStart = i % safeH2Every === 0;
    if (isSectionStart) {
      lines.push(`## ${safeH2Prefix} ${h2Index}`);
      h2Index += 1;
    } else if (safeH3Every > 0 && i % safeH3Every === 0) {
      lines.push(`### ${safeH3Prefix} ${h3Index}`);
      h3Index += 1;
    }
    lines.push(paragraphs[i]);
  }

  return lines.join('\n\n');
}

async function findFirstHandle(
  page: Page,
  selectors: string[],
  timeoutMs: number
): Promise<{ selector: string; handle: ElementHandle<Element> } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const selector of selectors) {
      const handle = await page.$(selector);
      if (handle) return { selector, handle };
    }
    await sleep(200);
  }
  return null;
}

async function findFirstVisibleHandle(
  page: Page,
  selectors: string[],
  timeoutMs: number
): Promise<{ selector: string; handle: ElementHandle<Element> } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const selector of selectors) {
      const handle = await page.$(selector);
      if (!handle) continue;
      const box = await handle.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        return { selector, handle };
      }
      await handle.dispose().catch(() => {});
    }
    await sleep(200);
  }
  return null;
}

function normalizeUiText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').trim().toLowerCase();
}

async function clickByText(params: {
  page: Page;
  texts: string[];
  timeoutMs: number;
}): Promise<boolean> {
  const { page, texts, timeoutMs } = params;
  if (texts.length === 0) return false;
  const normalizedTargets = texts.map((text) => normalizeUiText(text));

  const found = await page
    .waitForFunction(
      (targets) => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button, a, [role="button"], input[type="button"], input[type="submit"]'
          )
        );
        for (const el of candidates) {
          const label =
            (el instanceof HTMLInputElement ? el.value : el.innerText) ||
            el.getAttribute('aria-label') ||
            '';
          const normalized = label.replace(/\\s+/g, '').trim().toLowerCase();
          if (!normalized) continue;
          if (targets.some((t: string) => normalized.includes(t))) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            el.click();
            return true;
          }
        }
        return false;
      },
      { timeout: timeoutMs },
      normalizedTargets
    )
    .then(() => true)
    .catch(() => false);

  return found;
}

function attachDialogHandler(page: Page): void {
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    console.warn(`Dialog detected: ${message}`);
    if (dialogAction === 'accept') {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });
}

function extractTextBlocks(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const blocks: string[] = [];
  const selectors = ['h1', 'h2', 'h3', 'p', 'li', 'blockquote'];
  $(selectors.join(',')).each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (text) blocks.push(text);
  });
  return blocks;
}

function selectQuotes(params: {
  detailPages: DetailPage[];
  limit: number;
  perPageLimit: number;
  minLength: number;
  maxLength: number;
}): Quote[] {
  const safeLimit = Math.max(0, Math.floor(params.limit));
  if (safeLimit === 0) return [];
  const perPage = Math.max(1, Math.floor(params.perPageLimit));
  const minLength = Math.max(10, Math.floor(params.minLength));
  const maxLength = Math.max(minLength, Math.floor(params.maxLength));
  const quotes: Quote[] = [];
  const seen = new Set<string>();

  for (const page of params.detailPages) {
    if (quotes.length >= safeLimit) break;
    let addedForPage = 0;
    const blocks = extractTextBlocks(page.content);
    for (const block of blocks) {
      const normalized = normalizeWhitespace(block);
      if (normalized.length < minLength) continue;
      const shortened =
        normalized.length > maxLength
          ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
          : normalized;
      if (seen.has(shortened)) continue;
      seen.add(shortened);
      quotes.push({
        text: shortened,
        url: page.url,
        title: page.title,
      });
      addedForPage += 1;
      if (addedForPage >= perPage || quotes.length >= safeLimit) break;
    }
  }

  return quotes;
}

function buildSourceDigest(detailPages: DetailPage[], quotes: Quote[]): string {
  const lines: string[] = [];
  lines.push('参考記事:');
  for (const page of detailPages) {
    const title = page.title || '無題';
    lines.push(`- ${title} (${page.url})`);
  }
  if (quotes.length > 0) {
    lines.push('', '引用候補:');
    for (const quote of quotes) {
      lines.push(`- ${quote.text} (${quote.url})`);
    }
  }
  return lines.join('\n');
}

function buildArticlePrompt(params: {
  charTarget: number;
  instruction?: string;
  sourceDigest: string;
}): string {
  const lines: string[] = [
    `以下の参考情報をもとに、日本語で約${params.charTarget}文字の記事を作成してください。`,
    `上限は${articleCharMax}文字以内にしてください。`,
    '条件:',
    '- オリジナルの文章で書く',
    '- 参考情報の表現や構成をそのまま貼り付けない',
    '- 同じ語順・言い回し・見出し構成は避ける',
    '- タイトルは参考記事と異なる言い回しにする（語順や単語の並びを変える）',
    '- 具体例や気づきが伝わる構成にする',
    ...(articleOutputMarkdown
      ? [
          '- Markdown形式で出力する',
          '- 見出しは「##」「###」を使う',
          '- 箇条書きは「- 」を使う',
          '- 番号付きリストは「1. 」形式にする',
          '- 強調は「**太字**」、取り消し線は「~~取り消し~~」を使う',
          '- 引用は「> 」を使う',
        ]
      : []),
    '出力形式:',
    'TITLE: <タイトル>',
    'BODY:',
    '<本文>',
  ];
  if (params.instruction) {
    lines.push('', `追加指示: ${params.instruction}`);
  }
  lines.push('', '参考情報:', params.sourceDigest);
  return lines.join('\n');
}

async function runCommand(
  command: string,
  input: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: 'pipe' });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Context7 command timed out.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Context7 command failed (${code}). ${Buffer.concat(
              stderr
            ).toString('utf-8')}`
          )
        );
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf-8').trim());
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function callContext7Api(params: {
  url: string;
  apiKey?: string;
  model?: string;
  prompt: string;
  charTarget: number;
  timeoutMs: number;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const response = await fetch(params.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: params.prompt,
      model: params.model,
      max_chars: params.charTarget,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Context7 API error: ${response.status} ${text}`);
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.trim();
  }

  if (!parsed || typeof parsed !== 'object') {
    return text.trim();
  }

  const data = parsed as Record<string, unknown>;
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const firstChoice = choices?.[0];
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  const extracted =
    data.text ??
    data.output ??
    data.result ??
    data.content ??
    message?.content ??
    firstChoice?.text;

  if (typeof extracted !== 'string') {
    throw new Error('Context7 API response did not include text.');
  }
  return extracted.trim();
}

function parseGeneratedArticle(raw: string): { title: string; body: string } {
  const cleaned = raw.trim();
  const titleMatch = cleaned.match(/^TITLE:\s*(.+)$/m);
  const bodyMatch = cleaned.match(/BODY:\s*([\s\S]+)$/m);
  let title = titleMatch ? titleMatch[1].trim() : '';
  let body = bodyMatch ? bodyMatch[1].trim() : cleaned;
  if (!bodyMatch && titleMatch) {
    body = cleaned.replace(/^TITLE:\s*.+$/m, '').trim();
  }

  if (!title) {
    const lines = cleaned
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 0 && lines[0].length <= 80) {
      title = lines[0];
      body = lines.slice(1).join('\n').trim();
    }
  }

  return { title, body };
}

function clampBodyLength(body: string, maxChars: number): string {
  if (maxChars <= 0 || body.length <= maxChars) return body;
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let count = 0;

  for (const paragraph of paragraphs) {
    const separator = chunks.length > 0 ? 2 : 0; // '\n\n'
    const nextCount = count + separator + paragraph.length;
    if (nextCount > maxChars) break;
    if (separator > 0) count += separator;
    chunks.push(paragraph);
    count += paragraph.length;
  }

  if (chunks.length > 0) {
    return chunks.join('\n\n').slice(0, maxChars).trim();
  }

  return body.slice(0, maxChars).trim();
}

async function generateDraftArticle(
  detailPages: DetailPage[]
): Promise<DraftArticle> {
  if (detailPages.length === 0) {
    throw new Error('No detail pages available for draft generation.');
  }
  const quotes = selectQuotes({
    detailPages,
    limit: quoteLimit,
    perPageLimit: quotePerPageLimit,
    minLength: quoteMinLength,
    maxLength: quoteMaxLength,
  });
  const sourceDigest = buildSourceDigest(detailPages, quotes);
  const prompt = buildArticlePrompt({
    charTarget: articleCharTarget,
    instruction: articleInstruction,
    sourceDigest,
  });

  let raw = '';
  if (context7ApiUrl) {
    raw = await callContext7Api({
      url: context7ApiUrl,
      apiKey: context7ApiKey,
      model: context7Model,
      prompt,
      charTarget: articleCharTarget,
      timeoutMs: context7TimeoutMs,
    });
  } else if (resolvedContext7Command) {
    raw = await runCommand(resolvedContext7Command, prompt, context7TimeoutMs);
  } else {
    throw new Error(
      'CONTEXT7_COMMAND/CONTEXT7_API_URL or DEFAULT_CONTEXT7_COMMAND is required.'
    );
  }

  const parsed = parseGeneratedArticle(raw);
  return {
    title: parsed.title,
    body: parsed.body,
    raw,
    prompt,
    quotes,
  };
}

async function loadPostBodyFromFile(filePath: string): Promise<string | null> {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    const trimmed = text.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

function chooseFallbackTitle(detailPages: DetailPage[]): string {
  for (const page of detailPages) {
    if (page.title) return page.title;
  }
  return '無題';
}

async function resolveDraftArticle(
  detailPages: DetailPage[]
): Promise<DraftArticle | null> {
  if (postBodyOverride) {
    const { attributes, body } = postParseFrontMatter
      ? parseFrontMatter(postBodyOverride)
      : { attributes: {}, body: postBodyOverride };
    const formattedBody = applyAutoHeadings(body);
    return {
      title:
        postTitleOverride ??
        extractTitleFromAttributes(attributes) ??
        '',
      body: formattedBody,
      raw: body,
      prompt: '',
      quotes: [],
      tags: extractTagsFromAttributes(attributes),
      thumbnailPath: extractThumbnailFromAttributes(attributes),
    };
  }

  if (postBodyFile) {
    const fileBody = await loadPostBodyFromFile(postBodyFile);
    if (fileBody) {
      const { attributes, body } = postParseFrontMatter
        ? parseFrontMatter(fileBody)
        : { attributes: {}, body: fileBody };
      const formattedBody = applyAutoHeadings(body);
      return {
        title:
          postTitleOverride ??
          extractTitleFromAttributes(attributes) ??
          '',
        body: formattedBody,
        raw: body,
        prompt: '',
        quotes: [],
        tags: extractTagsFromAttributes(attributes),
        thumbnailPath: extractThumbnailFromAttributes(attributes),
      };
    }
  }

  if (!generateArticle) return null;
  const draft = await generateDraftArticle(detailPages);
  const bodyWithHeadings = applyAutoHeadings(draft.body);
  const trimmedBody = clampBodyLength(bodyWithHeadings, articleCharMax);
  return {
    ...draft,
    body: trimmedBody,
  };
}

async function fillPostComposer(params: {
  page: Page;
  title: string;
  body: string;
  fillTitle: boolean;
  fillBody: boolean;
  timeoutMs: number;
}): Promise<void> {
  const { page, title, body, fillTitle, fillBody, timeoutMs } = params;
  const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  const delayMs = Math.max(0, inputDelayMs);
  const chunkSize = Math.max(1, inputChunkSize);

  const typeLikeHuman = async (text: string): Promise<void> => {
    if (!text) return;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    for (const chunk of chunks) {
      await page.keyboard.type(chunk, { delay: delayMs });
      if (delayMs > 0) {
        await sleep(Math.min(200, delayMs * 2));
      }
    }
  };

  await page.bringToFront().catch(() => {});

  if (fillTitle && title) {
    const titleHandleInfo = await findFirstVisibleHandle(
      page,
      postTitleSelectors,
      timeoutMs
    );
    if (!titleHandleInfo) throw new Error('Title input not found.');
    const { selector: titleSelector, handle: titleHandle } = titleHandleInfo;
    const titleBox = await titleHandle.boundingBox();
    if (titleBox) {
      await page.mouse.click(titleBox.x + 10, titleBox.y + titleBox.height / 2);
    } else {
      await titleHandle.click();
    }
    await sleep(100);
    await page.keyboard.down(modifierKey);
    await page.keyboard.press('A');
    await page.keyboard.up(modifierKey);
    await page.keyboard.press('Backspace');
    await typeLikeHuman(title);
    const titleValue = await page
      .$eval(titleSelector, (el) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          return el.value;
        }
        return (el as HTMLElement).innerText || el.textContent || '';
      })
      .catch(() => '');
    if (normalizeWhitespace(titleValue) !== normalizeWhitespace(title)) {
      await page.evaluate(
        (selector, value) => {
          const el = document.querySelector(selector) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | HTMLElement
            | null;
          if (!el) return;
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.focus();
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
          el.focus();
          el.textContent = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.textContent = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        titleSelector,
        title
      );
    }
  }

  if (fillBody && body) {
    const editorHandleInfo = await findFirstVisibleHandle(
      page,
      postBodySelectors,
      timeoutMs
    );
    if (!editorHandleInfo) throw new Error('Editor not found.');
    const { selector: editorSelector, handle: editorHandle } = editorHandleInfo;
    await page.waitForFunction(
      (selector) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return false;
        const editable =
          el.isContentEditable
            ? el
            : (el.querySelector('[contenteditable="true"]') as HTMLElement | null);
        if (!editable) return false;
        const rect = editable.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      },
      { timeout: timeoutMs },
      editorSelector
    );
    const editorBox = await editorHandle.boundingBox();
    if (editorBox) {
      await page.mouse.click(
        editorBox.x + 10,
        editorBox.y + Math.min(30, editorBox.height / 2)
      );
    } else {
      await editorHandle.click();
    }
    await sleep(100);
    await page.keyboard.down(modifierKey);
    await page.keyboard.press('A');
    await page.keyboard.up(modifierKey);
    await page.keyboard.press('Backspace');
    if (postUseMarkdownShortcuts) {
      await typeBodyWithShortcuts({ page, body, delayMs });
    } else {
      await typeLikeHuman(body);
    }
    const bodyText = await page
      .$eval(
        editorSelector,
        (el) => (el as HTMLElement).innerText || ''
      )
      .catch(() => '');
    if (bodyText.trim().length < Math.min(30, body.length * 0.2)) {
      await page.evaluate(
        (selector, value) => {
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) return;
          const editable =
            el.isContentEditable
              ? el
              : (el.querySelector('[contenteditable="true"]') as HTMLElement | null);
          if (!editable) return;
          editable.focus();
          const selection = window.getSelection();
          if (!selection) return;
          const range = document.createRange();
          range.selectNodeContents(editable);
          selection.removeAllRanges();
          selection.addRange(range);
          document.execCommand('insertText', false, value);
        },
        editorSelector,
        body
      );
    }
  }
}

async function fillPostTags(params: {
  page: Page;
  tags: string[];
  timeoutMs: number;
}): Promise<boolean> {
  const { page, tags, timeoutMs } = params;
  const uniqueTags = Array.from(new Set(tags.map((tag) => tag.trim()))).filter(
    Boolean
  );
  if (uniqueTags.length === 0) return false;

  const tagHandleInfo = await findFirstVisibleHandle(
    page,
    postTagSelectors,
    timeoutMs
  );
  if (!tagHandleInfo) {
    console.warn('Tag input not found.');
    return false;
  }
  const { handle: tagHandle } = tagHandleInfo;
  const tagBox = await tagHandle.boundingBox();
  if (tagBox) {
    await page.mouse.click(tagBox.x + 5, tagBox.y + tagBox.height / 2);
  } else {
    await tagHandle.click();
  }
  await sleep(100);

  for (const tag of uniqueTags) {
    await page.keyboard.type(tag, { delay: Math.max(0, inputDelayMs) });
    await page.keyboard.press('Enter');
    await sleep(150);
  }
  return true;
}

async function uploadPostThumbnail(params: {
  page: Page;
  filePath: string;
  timeoutMs: number;
}): Promise<boolean> {
  const { page, filePath, timeoutMs } = params;
  if (!filePath) return false;
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      console.warn(`Thumbnail path is not a file: ${absolutePath}`);
      return false;
    }
  } catch {
    console.warn(`Thumbnail file not found: ${absolutePath}`);
    return false;
  }

  const inputHandleInfo = await findFirstHandle(
    page,
    postThumbnailInputSelectors,
    Math.min(timeoutMs, 5000)
  );
  if (inputHandleInfo) {
    await (inputHandleInfo.handle as ElementHandle<HTMLInputElement>).uploadFile(
      absolutePath
    );
    return true;
  }

  const fileChooserPromise = page
    .waitForFileChooser({ timeout: timeoutMs })
    .catch(() => null);
  const clicked = await clickByText({
    page,
    texts: postThumbnailButtonTexts,
    timeoutMs,
  });
  const fileChooser = await fileChooserPromise;
  if (clicked && fileChooser) {
    await fileChooser.accept([absolutePath]);
    return true;
  }

  console.warn('Thumbnail uploader not found.');
  return false;
}

async function clickPostAction(params: {
  page: Page;
  selector?: string;
  textCandidates?: string[];
  timeoutMs: number;
}): Promise<boolean> {
  const { page, selector, textCandidates = [], timeoutMs } = params;
  if (selector) {
    const handle = await page
      .waitForSelector(selector, { timeout: timeoutMs })
      .catch(() => null);
    if (!handle) return false;

    try {
      await page.click(selector);
      return true;
    } catch {
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const clickable = el.closest('button, a') ?? el;
        (clickable as HTMLElement).click();
        return true;
      }, selector);
    }
  }

  if (textCandidates.length > 0) {
    return clickByText({ page, texts: textCandidates, timeoutMs });
  }

  return false;
}

async function waitForEnter(
  message: string,
  timeoutMs: number
): Promise<void> {
  if (!process.stdin.isTTY) {
    if (timeoutMs > 0) {
      console.log(`${message} (auto-close in ${timeoutMs}ms)`);
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    }
    return;
  }
  console.log(message);
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

function normalizeClassName(value: string): string {
  return value.replace(/^\.+/, '').trim();
}

function buildDetailTargets(params: {
  seedTargets?: DetailTarget[];
  cardLinks: Iterable<string>;
  articleTitleMap: Map<string, string>;
}): DetailTarget[] {
  const targets: DetailTarget[] = [];
  const seen = new Set<string>();
  let hasCardLinks = false;

  const pushTarget = (url: string, title?: string): void => {
    if (!url) return;
    if (seen.has(url)) return;
    seen.add(url);
    targets.push({ url, title });
  };

  if (params.seedTargets) {
    for (const target of params.seedTargets) {
      pushTarget(target.url, target.title);
    }
  }

  for (const link of params.cardLinks) {
    hasCardLinks = true;
    pushTarget(link, params.articleTitleMap.get(link));
  }

  if (!hasCardLinks) {
    for (const [url, title] of params.articleTitleMap.entries()) {
      pushTarget(url, title);
    }
  }

  return targets;
}

async function fetchDetailPages(params: {
  page: Page;
  targets: DetailTarget[];
  limit: number;
}): Promise<DetailPage[]> {
  const safeLimit = Number.isFinite(params.limit)
    ? Math.max(0, Math.floor(params.limit))
    : 0;
  if (safeLimit === 0) return [];

  const selectedTargets = params.targets.slice(0, safeLimit);
  const detailPages: DetailPage[] = [];

  for (const target of selectedTargets) {
    console.log(`[detail] Accessing: ${target.url}`);
    await params.page.goto(target.url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await params.page.waitForSelector('body');
    await params.page
      .waitForFunction(
        (selectors, preferredSelectors) => {
          function hasText(selector: string): boolean {
            const el = document.querySelector(selector);
            if (!el) return false;
            const text = el.textContent?.replace(/\s+/g, '').trim() ?? '';
            return text.length > 0;
          }
          for (const selector of preferredSelectors) {
            if (hasText(selector)) return true;
          }
          for (const selector of selectors) {
            if (hasText(selector)) return true;
          }
          return false;
        },
        { timeout: 15000 },
        detailContentSelectors,
        detailBodySelectors
      )
      .catch(() => false);

    const detailData = await params.page.evaluate((selectors) => {
      const title = document.title?.trim() ?? '';
      let content = '';

      for (const selector of selectors) {
        const el = document.querySelector<HTMLElement>(selector);
        if (el?.innerHTML) {
          const candidate = el.innerHTML.trim();
          if (candidate) {
            content = candidate;
            break;
          }
        }
      }

      if (!content && document.body?.innerHTML) {
        content = document.body.innerHTML.trim();
      }

      return { title, content };
    }, detailContentSelectors);

    const resolvedTitle = detailData.title || target.title || '';
    detailPages.push({
      url: target.url,
      title: resolvedTitle,
      content: detailData.content,
    });
  }

  return detailPages;
}

/* =========================
 * main
 * ========================= */
async function main(): Promise<void> {
  const targets = rawTargetsEnv
    ? parseTargetList(rawTargetsEnv)
    : rawTargetEnv
    ? [rawTargetEnv]
    : defaultTargetUrls;
  const resolvedTargets =
    targets.length > 0 ? targets : defaultTargetUrls;

  let browser: Browser | null = null;

  try {
    const resolvedUserDataDir = persistSession
      ? userDataDir || path.join(process.cwd(), 'data', 'puppeteer-profile')
      : undefined;
    browser = await puppeteer.launch({
      headless,
      executablePath: executablePath || undefined,
      userDataDir: resolvedUserDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1280,800',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    if (resolvedUserDataDir) {
      console.log(`Using user data dir: ${resolvedUserDataDir}`);
    }

    const page = await browser.newPage();
    attachDialogHandler(page);
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);

    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const line = `[console.${msg.type()}] ${msg.text()}`;
      consoleLogs.push(line);
    });
    page.on('pageerror', (err) => {
      consoleLogs.push(`[pageerror] ${String(err)}`);
    });
    page.on('requestfailed', (req) => {
      const failure = req.failure();
      consoleLogs.push(
        `[requestfailed] ${req.method()} ${req.url()} ${
          failure?.errorText ?? ''
        }`
      );
    });

    await page.setViewport({
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
    });

    // 日本向け設定
    await page.setUserAgent(defaultUserAgent);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9',
    });

    const hasLoginCredentials = Boolean(loginEmail && loginPassword);
    if (hasLoginCredentials && loginEmail && loginPassword) {
      const loginOk = await ensureLoggedIn({
        page,
        email: loginEmail,
        password: loginPassword,
        loginUrl,
        timeoutMs: loginTimeoutMs,
      });
      if (!loginOk) {
        console.warn(
          'Login did not complete. Continuing without authenticated session.'
        );
      }
    }

    const normalizedCardClass = normalizeClassName(cardClassName);
    const cardPages: CardPageSummary[] = [];
    const articlePages: Array<{
      url: string;
      pageTitle: string;
      foundAnyContent: boolean;
      articles: Article[];
    }> = [];
    const uniqueCardLinks = new Set<string>();
    const articleTitleMap = new Map<string, string>();
    const directDetailTargets: DetailTarget[] = [];
    const seenDirectDetailUrls = new Set<string>();

    for (let index = 0; index < resolvedTargets.length; index += 1) {
      const target = resolvedTargets[index];
      const url = await resolveTargetUrl(target);

      console.log(`Accessing: ${url}`);

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // まずは最低限レンダリングを待つ（SPAでnetworkidleが効かないことがある）
      await page.waitForSelector('body');

      if (await isLoginPage(page)) {
        console.warn('Login page detected while visiting target.');
        if (!hasLoginCredentials || !loginEmail || !loginPassword) {
          console.warn(
            'LOGIN_EMAIL/LOGIN_PASSWORD (or EMAIL/PASSWORD) not set. Skipping target.'
          );
          await saveDebugArtifacts(page, `login_required_${index + 1}`);
          continue;
        }

        const loginOk = await submitLoginForm({
          page,
          email: loginEmail,
          password: loginPassword,
          timeoutMs: loginTimeoutMs,
        });
        if (!loginOk) {
          console.warn('Login failed or requires manual action.');
          await saveDebugArtifacts(page, `login_failed_${index + 1}`);
          continue;
        }

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
        await page.waitForSelector('body');
      }

      // 無限スクロール対応（記事DOMが初期に無いケースがあるので先にスクロールする）
      await autoScroll(page, 5);

      const foundAnyContent = await page
        .waitForFunction(
          () =>
            Boolean(
              document.querySelector('article') ||
                document.querySelector('main') ||
                document.querySelector('[role="main"]') ||
                document.querySelector('a[href]')
            ),
          { timeout: 15000 }
        )
        .then(() => true)
        .catch(() => false);

      const title = await page.title();
      console.log(`Page title: ${title}`);

      /* =========================
       * 記事情報取得
       * ========================= */
      const pageData: {
        articles: Article[];
        cardTexts: string[];
        cardLinks: string[];
      } = await page.evaluate(
        function (maxArticles: number | null, cardClass: string) {
          const results: Article[] = [];
          const cardTexts: string[] = [];
          const cardLinks: string[] = [];
          const cardLinkSet = new Set<string>();
          const limit =
            typeof maxArticles === 'number' && Number.isFinite(maxArticles)
              ? Math.max(0, Math.floor(maxArticles))
              : null;
          const fallbackLimit = limit ?? 50;
          const normalizedCardClass = cardClass.trim().replace(/^\.+/, '');

          if (normalizedCardClass) {
            const selector = `.${normalizedCardClass}`;
            const cardElements =
              document.querySelectorAll<HTMLElement>(selector);
            for (let i = 0; i < cardElements.length; i += 1) {
              const element = cardElements[i];
              const rawText = element.textContent;
              if (!rawText) continue;
              const text = rawText.replace(/\s+/g, ' ').trim();
              if (text) cardTexts.push(text);

              const anchors =
                element.querySelectorAll<HTMLAnchorElement>('a[href]');
              for (let j = 0; j < anchors.length; j += 1) {
                const anchor = anchors[j];
                const href = anchor.getAttribute('href') || '';
                if (!href) continue;
                let abs = '';
                try {
                  abs = new URL(href, location.origin).href;
                } catch {
                  abs = '';
                }
                if (!abs) continue;
                if (cardLinkSet.has(abs)) continue;
                cardLinkSet.add(abs);
                cardLinks.push(abs);
              }
            }
          }

          const articleElements =
            document.querySelectorAll<HTMLElement>('article');
          for (let i = 0; i < articleElements.length; i += 1) {
            const article = articleElements[i];
            let title = '';
            let url = '';
            let author = '';

            const titleEl =
              article.querySelector('h1, h2, h3') || article.querySelector('a');
            const linkEl = article.querySelector('a[href]');
            const authorEl =
              article.querySelector('[data-testid="user-name"]') ||
              article.querySelector('span');

            if (titleEl?.textContent) {
              title = titleEl.textContent.replace(/\s+/g, ' ').trim();
            }
            if (authorEl?.textContent) {
              author = authorEl.textContent.replace(/\s+/g, ' ').trim();
            }

            if (linkEl) {
              const href = linkEl.getAttribute('href') || '';
              if (href) {
                try {
                  url = new URL(href, location.origin).href;
                } catch {
                  url = '';
                }
              }
            }

            if (title && url) results.push({ title, url, author });
            if (limit && results.length >= limit) break;
          }

          if (results.length === 0) {
            const anchors =
              document.querySelectorAll<HTMLAnchorElement>('a[href]');
            const seen = new Set<string>();

            for (let i = 0; i < anchors.length; i += 1) {
              const anchor = anchors[i];
              const href = anchor.getAttribute('href') || '';
              if (!href) continue;

              let abs = '';
              try {
                abs = new URL(href, location.origin).href;
              } catch {
                abs = '';
              }
              if (!abs) continue;
              if (!/\/n\//.test(abs) && !/note\.com\/n\//.test(abs)) continue;
              if (seen.has(abs)) continue;
              seen.add(abs);

              let title = '';
              if (anchor.textContent) {
                title = anchor.textContent.replace(/\s+/g, ' ').trim();
              }
              if (!title) {
                const ariaLabel = anchor.getAttribute('aria-label');
                if (ariaLabel) {
                  title = ariaLabel.replace(/\s+/g, ' ').trim();
                }
              }
              if (!title) continue;

              results.push({ title, url: abs, author: '' });
              if (results.length >= fallbackLimit) break;
            }
          }

          return { articles: results, cardTexts, cardLinks };
        },
        maxArticles,
        normalizedCardClass
      );

      console.log(
        `[${index + 1}/${resolvedTargets.length}] Found articles: ${
          pageData.articles.length
        }`
      );
      pageData.articles.forEach((a, articleIndex) => {
        console.log(
          `[${articleIndex + 1}] ${a.title}\n  Author: ${a.author}\n  URL: ${
            a.url
          }`
        );
      });
      console.log(
        `[${index + 1}/${resolvedTargets.length}] Found card texts: ${
          pageData.cardTexts.length
        }`
      );
      console.log(
        `[${index + 1}/${resolvedTargets.length}] Found card links: ${
          pageData.cardLinks.length
        }`
      );

      for (const link of pageData.cardLinks) {
        uniqueCardLinks.add(link);
      }
      for (const article of pageData.articles) {
        if (!article.url) continue;
        if (!articleTitleMap.has(article.url)) {
          articleTitleMap.set(article.url, article.title);
        }
      }

      cardPages.push({
        url,
        pageTitle: title,
        foundAnyContent,
        cardTexts: pageData.cardTexts,
        cardLinks: pageData.cardLinks,
      });
      articlePages.push({
        url,
        pageTitle: title,
        foundAnyContent,
        articles: pageData.articles,
      });

      const isDetailPage = await page.evaluate((selectors) => {
        return selectors.some((selector) => {
          const el = document.querySelector(selector);
          if (!el) return false;
          const text = el.textContent?.replace(/\s+/g, '').trim() ?? '';
          return text.length > 0;
        });
      }, detailBodySelectors);
      if (isDetailPage && !seenDirectDetailUrls.has(url)) {
        seenDirectDetailUrls.add(url);
        directDetailTargets.push({ url, title });
      }

      // 0件 or 主要DOM無しなら、原因調査用に必ず成果物を残す
      if (!foundAnyContent || pageData.articles.length === 0) {
        console.log(
          `No articles found (foundAnyContent=${foundAnyContent}). Saving debug artifacts...`
        );
        await saveDebugArtifacts(page, `no_articles_${index + 1}`);
        if (consoleLogs.length > 0) {
          console.log('Browser logs (tail):');
          for (const line of consoleLogs.slice(-50)) {
            console.log(line);
          }
        }
      }

      const shouldSaveScreenshot =
        resolvedTargets.length === 1 || index === resolvedTargets.length - 1;
      if (shouldSaveScreenshot) {
        await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Saved screenshot: ${screenshotPath}`);
      }
    }

    const detailTargets = buildDetailTargets({
      seedTargets: directDetailTargets,
      cardLinks: uniqueCardLinks,
      articleTitleMap,
    });
    const detailPages = await fetchDetailPages({
      page,
      targets: detailTargets,
      limit: detailPageLimit,
    });
    await saveDetailPagesJson(detailPages);

    let draftArticle: DraftArticle | null = null;
    if (generateArticle || postBodyOverride || postBodyFile) {
      try {
        draftArticle = await resolveDraftArticle(detailPages);
        if (draftArticle) {
          const fallbackTitle = chooseFallbackTitle(detailPages);
          draftArticle.title =
            postTitleOverride || draftArticle.title || fallbackTitle;
          if (postTags.length > 0) {
            draftArticle.tags = postTags;
          } else if (!draftArticle.tags || draftArticle.tags.length === 0) {
            draftArticle.tags = defaultTags;
          }
          if (postThumbnailPath) {
            draftArticle.thumbnailPath = postThumbnailPath;
          }
          if (generateArticle && generatedArticlePath) {
            await fs.mkdir(path.dirname(generatedArticlePath), {
              recursive: true,
            });
            await fs.writeFile(generatedArticlePath, draftArticle.raw, 'utf-8');
            console.log(`Saved generated article: ${generatedArticlePath}`);
          }
          console.log(
            `Draft length: ${draftArticle.body.length} chars (target: ${articleCharTarget})`
          );
        }
      } catch (err) {
        console.warn('Failed to prepare draft article:', err);
        if (generateArticle) {
          process.exitCode = 1;
        }
      }
    }

    await saveArticlesJson({ pages: articlePages });
    await saveCardTextsJson({
      className: normalizedCardClass,
      pages: cardPages,
      uniqueLinks: Array.from(uniqueCardLinks),
    });

    if (openPostPage) {
      if (headless) {
        console.warn('HEADLESS=true; set HEADLESS=false to review the post.');
      }
      const composerPage = await openPostComposer({
        page,
        postPageUrls,
        timeoutMs: loginTimeoutMs,
      });
      if (composerPage) {
        console.log('Post composer opened.');
        if (draftArticle) {
          if (!fillPostTitle && !fillPostBody) {
            console.warn(
              'POST_FILL_TITLE and POST_FILL_BODY are false; skipping input.'
            );
          } else {
            await fillPostComposer({
              page: composerPage,
              title: draftArticle.title,
              body: draftArticle.body,
              fillTitle: fillPostTitle,
              fillBody: fillPostBody,
              timeoutMs: loginTimeoutMs,
            });
            console.log('Draft content filled.');
          }
          if (draftArticle.tags && draftArticle.tags.length > 0) {
            const tagged = await fillPostTags({
              page: composerPage,
              tags: draftArticle.tags,
              timeoutMs: loginTimeoutMs,
            });
            if (tagged) {
              console.log(`Tags filled: ${draftArticle.tags.join(', ')}`);
            }
          }
          if (draftArticle.thumbnailPath) {
            const uploaded = await uploadPostThumbnail({
              page: composerPage,
              filePath: draftArticle.thumbnailPath,
              timeoutMs: loginTimeoutMs,
            });
            if (uploaded) {
              console.log(`Thumbnail uploaded: ${draftArticle.thumbnailPath}`);
            }
          }
        } else {
          console.warn('No draft content available to fill.');
        }
        if (postClickSelector || postActionTexts.length > 0) {
          const clicked = await clickPostAction({
            page: composerPage,
            selector: postClickSelector,
            textCandidates: postActionTexts,
            timeoutMs: postClickTimeoutMs,
          });
          if (clicked) {
            console.log(
              `Clicked post action: ${postClickSelector ?? postActionTexts[0]}`
            );
          } else {
            console.warn('Post action not found.');
          }
        }
        if (pauseAfterPost) {
          await waitForEnter(
            'Review the post screen, then press Enter to close.',
            pauseAfterPostMs
          );
        }
      } else {
        console.warn('Failed to open post composer.');
        await saveDebugArtifacts(page, 'post_composer_failed');
      }
    }
  } catch (err) {
    console.error('Error occurred:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    const shouldCloseBrowser = !(pauseAfterPost || keepBrowserOpen);
    if (browser && shouldCloseBrowser) {
      await browser.close();
    } else if (browser && !shouldCloseBrowser) {
      console.log('Leaving browser open for review. Use Ctrl+C to exit.');
    }
  }
}

main();
