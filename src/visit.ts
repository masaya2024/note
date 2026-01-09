import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { Browser, Page } from 'puppeteer';

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

/* =========================
 * env
 * ========================= */
const rawTarget = process.env.TARGET_URL?.trim() || 'https://note.com/';
const rawTargets = process.env.TARGET_URLS?.trim();
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
const detailPageLimit = parsePositiveInt(process.env.DETAIL_PAGE_LIMIT) ?? 1;

const headless = process.env.HEADLESS !== 'false';
const executablePath = process.env.CHROME_PATH?.trim();

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

/* =========================
 * util
 * ========================= */
function parsePositiveInt(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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
          const hasText = (selector: string): boolean => {
            const el = document.querySelector(selector);
            if (!el) return false;
            const text = el.textContent?.replace(/\s+/g, '').trim() ?? '';
            return text.length > 0;
          };
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
  const targets =
    rawTargets && rawTargets.length > 0
      ? parseTargetList(rawTargets)
      : [rawTarget];
  const resolvedTargets = targets.length > 0 ? targets : [rawTarget];

  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      headless,
      executablePath: executablePath || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1280,800',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const page = await browser.newPage();
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
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9',
    });

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

    await saveArticlesJson({ pages: articlePages });
    await saveCardTextsJson({
      className: normalizedCardClass,
      pages: cardPages,
      uniqueLinks: Array.from(uniqueCardLinks),
    });
  } catch (err) {
    console.error('Error occurred:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
