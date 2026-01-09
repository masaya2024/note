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
- `ARTICLES_JSON` (path to write scraped articles as JSON)
- `MAX_ARTICLES` (limit article count when set)
- `CARD_CLASS` (default: `m-largeNoteWrapper__card`)
- `CARD_TEXTS_JSON` (default: `data/card-texts.json`)
  - includes `texts` and de-duplicated `links` found inside the card elements
  - when `TARGET_URLS` is set, the output is aggregated with `uniqueLinks`
# note
# note
# note
# note
