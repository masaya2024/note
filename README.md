# Content Collector (TypeScript)

Minimal TypeScript + Node.js setup for loading HTML from a local file or a permitted URL and parsing basic headings.

## Requirements
- Node.js 18+

## Setup
```bash
npm install
```

## Run (local file)
```bash
npm run dev
```

## Run (URL)
```bash
SOURCE_URL="https://example.com" npm run dev
```

Optional environment variables:
- `SOURCE_FILE` (local HTML path, takes priority over `SOURCE_URL`)
- `SOURCE_URL` (URL to fetch)
- `FETCH_TIMEOUT_MS` (URL fetch timeout in milliseconds)
- `HEADINGS_JSON` (path to write extracted headings as JSON)

Use only sources you have permission to access and comply with the provider's terms.

## Puppeteer (visit + screenshot)
```bash
TARGET_URL="https://note.com/" npm run dev:visit
```
```bash
TARGET_URLS="https://note.com/topic/science_technology,https://note.com/topic/computer_it" npm run dev:visit
```
`TARGET_URLS` supports comma or newline separated lists.

Optional environment variables:
- `SCREENSHOT_PATH` (default: `data/page.png`)
- `HTML_DUMP_PATH` (default: `data/page.html`)
- `HEADLESS` set to `false` to show the browser window
- `CHROME_PATH` to use a system-installed Chrome/Chromium
- `LOGIN_EMAIL` / `LOGIN_PASSWORD` (attempt login when a login page is detected)
- `LOGIN_URL` (default: `https://note.com/login`)
- `LOGIN_TIMEOUT_MS` (login wait timeout in milliseconds)
- `EMAIL` / `PASSWORD` (aliases for login credentials)
- `OPEN_POST_PAGE` (set to `true` to open the "投稿" screen after scraping; if unset, it auto-opens when GENERATE_ARTICLE or POST_BODY/_FILE is set)
- `POST_PAGE_URL` (override the first URL tried for the editor)
- `POST_PAGE_URLS` (comma/newline separated list of editor URLs to try)
- `POST_FILL_TITLE` / `POST_FILL_BODY` (default: `true`; toggle which fields to fill)
- `POST_CLICK_SELECTOR` (optional CSS selector to click after filling)
- `POST_CLICK_TEXT` (optional button text to click after filling)
- `POST_ACTION` (`draft` or `publish` to click common buttons by text; default: `draft`, use `none` to disable)
- `POST_CLICK_TIMEOUT_MS` (timeout for `POST_CLICK_SELECTOR`)
- `PAUSE_AFTER_POST` / `KEEP_BROWSER_OPEN` (wait for Enter before closing the browser)
- `PAUSE_AFTER_POST_MS` (optional delay before closing when no TTY is available)
- `INPUT_DELAY_MS` (typing delay in milliseconds to mimic human input)
- `INPUT_CHUNK_SIZE` (characters per typing chunk)
- `POST_USE_MARKDOWN_SHORTCUTS` (default: `true`; apply editor shortcuts for headings/lists/quotes based on Markdown-like syntax)
- `POST_PARSE_INLINE_STYLES` (default: `true`; convert `**bold**` and `~~strike~~` using shortcuts)
- `DIALOG_ACTION` (`accept` or `dismiss` when a beforeunload dialog appears; default: `dismiss`)
- `PERSIST_SESSION` (set to `true` to reuse a browser profile)
- `USER_DATA_DIR` (profile directory when `PERSIST_SESSION=true`)
- `DETAIL_PAGES_JSON` (default: `detail-pages.json`)
- `DETAIL_PAGE_LIMIT` (limit the number of detail pages fetched)
- `ARTICLES_JSON` (path to write scraped articles as JSON)
- `MAX_ARTICLES` (limit article count when set)
- `CARD_CLASS` (default: `m-largeNoteWrapper__card`)
- `CARD_TEXTS_JSON` (default: `data/card-texts.json`)
  - includes `texts` and de-duplicated `links` found inside the card elements
  - when `TARGET_URLS` is set, the output is aggregated with `uniqueLinks`
- `DEFAULT_TARGET_URLS` (comma/newline separated fallback targets; default: note IT topics)
- `GENERATE_ARTICLE` (set to `true` to generate a draft from scraped detail pages)
- `ARTICLE_CHAR_TARGET` (default: `4000`)
- `ARTICLE_CHAR_MAX` (default: `5000`)
- `ARTICLE_INSTRUCTION` (additional guidance for the generator)
- `ARTICLE_OUTPUT_MARKDOWN` (default: `true`; ask the generator to emit Markdown headings/lists/inline styles)
- `AUTO_HEADINGS` (default: `true`; insert `##` / `###` headings into the body)
- `AUTO_HEADING_MIN_PARAGRAPHS` (default: `3`)
- `AUTO_HEADING_PARAGRAPH_TARGET` (default: `200`)
- `H2_EVERY` (default: `3`)
- `H3_EVERY` (default: `2`)
- `H2_PREFIX` (default: `見出し`)
- `H3_PREFIX` (default: `ポイント`)
- `QUOTE_LIMIT` (default: `6`)
- `QUOTE_PER_PAGE_LIMIT` (default: `2`)
- `QUOTE_MIN_LENGTH` (default: `30`)
- `QUOTE_MAX_LENGTH` (default: `220`)
- `CONTEXT7_COMMAND` (command to generate text; prompt is passed via stdin)
- `DEFAULT_CONTEXT7_COMMAND` (fallback command; default: `context7`)
- `CONTEXT7_API_URL` (HTTP endpoint for generation)
- `CONTEXT7_API_KEY` (optional bearer token)
- `CONTEXT7_MODEL` (optional model name for the API)
- `CONTEXT7_TIMEOUT_MS` (default: `60000`)
- `GENERATED_ARTICLE_PATH` (default: `data/generated-article.txt`)
- `POST_TITLE` (override the draft title)
- `POST_BODY` (override the draft body)
- `POST_BODY_FILE` (path to a file containing the body)
- `POST_TAGS` (comma/newline separated tags to input)
- `DEFAULT_TAGS` (comma/newline separated fallback tags; default: `IT`, use `none` to disable)
- `POST_THUMBNAIL_PATH` (path to an eyecatch/thumbnail image)
- `POST_PARSE_FRONTMATTER` (default: `true`; parse YAML front matter in POST_BODY/_FILE)
  - supported keys: `title`, `tags`, `thumbnail` / `eyecatch`
If a `.env` file exists in the project root, it is loaded before reading env vars.
# note
# note
# note
# note
