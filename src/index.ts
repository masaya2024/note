import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';

type Source = { kind: 'file'; path: string } | { kind: 'url'; url: string };
type Heading = { level: number; text: string };

const DEFAULT_SOURCE_FILE = path.join(process.cwd(), 'data', 'sample.html');
const headingsJsonPath = process.env.HEADINGS_JSON?.trim();
const fetchTimeoutMs = parsePositiveInt(process.env.FETCH_TIMEOUT_MS);

function parsePositiveInt(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveSource(): Source {
  const sourceFile = process.env.SOURCE_FILE?.trim();
  if (sourceFile) {
    return { kind: 'file', path: sourceFile };
  }

  const sourceUrl = process.env.SOURCE_URL?.trim();
  if (sourceUrl) {
    return { kind: 'url', url: sourceUrl };
  }

  return { kind: 'file', path: DEFAULT_SOURCE_FILE };
}

async function loadHtml(source: Source): Promise<string> {
  if (source.kind === 'file') {
    try {
      return await fs.readFile(source.path, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read file: ${source.path}`, { cause: err });
    }
  }

  const controller = fetchTimeoutMs ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), fetchTimeoutMs ?? 0)
    : null;
  let response: Response;

  try {
    response = await fetch(source.url, {
      headers: {
        'user-agent': 'content-collector/0.1 (+local)',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: controller?.signal,
    });
  } catch (err) {
    if (controller?.signal.aborted) {
      throw new Error(`Request timed out after ${fetchTimeoutMs}ms`);
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(
      `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return await response.text();
}

function extractHeadings(html: string): Heading[] {
  const $ = load(html);
  const headings: Heading[] = [];

  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) {
      const tag =
        (el as { tagName?: string; name?: string }).tagName ||
        (el as { tagName?: string; name?: string }).name ||
        '';
      const level = Number.parseInt(tag.replace(/[^\d]/g, ''), 10) || 0;
      headings.push({ level, text });
    }
  });

  return headings;
}

async function saveHeadingsJson(
  source: Source,
  headings: Heading[]
): Promise<void> {
  if (!headingsJsonPath) return;
  const normalizedSource =
    source.kind === 'file'
      ? { kind: 'file' as const, path: path.resolve(source.path) }
      : source;
  const payload = {
    source: normalizedSource,
    fetchedAt: new Date().toISOString(),
    headings,
  };

  try {
    await fs.mkdir(path.dirname(headingsJsonPath), { recursive: true });
    await fs.writeFile(
      headingsJsonPath,
      JSON.stringify(payload, null, 2),
      'utf-8'
    );
    console.log(`Saved headings JSON: ${headingsJsonPath}`);
  } catch (err) {
    console.warn('Failed to save headings JSON:', err);
  }
}

async function main(): Promise<void> {
  const source = resolveSource();
  const html = await loadHtml(source);
  const headings = extractHeadings(html);

  await saveHeadingsJson(source, headings);

  if (headings.length === 0) {
    console.log('No headings found.');
    return;
  }

  console.log('Headings:');
  for (const heading of headings) {
    console.log(`- ${heading.text}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
