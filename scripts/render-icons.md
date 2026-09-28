# Rendering the Earmode icons

The PNG icons are rendered from the SVG sources in `icons/`:

| Output | Source | Canvas | Mark size |
| --- | --- | --- | --- |
| `icons/icon16.png` | `icons/icon-small.svg` | 16x16 | 16x16 |
| `icons/icon32.png` | `icons/icon.svg` | 32x32 | 32x32 |
| `icons/icon48.png` | `icons/icon.svg` | 48x48 | 48x48 |
| `icons/icon128.png` | `icons/icon.svg` | 128x128 | 128x128 |
| `store-assets/store-icon-128.png` | `icons/icon.svg` | 128x128 | 96x96, centred (16px transparent padding) |

`icon-small.svg` is a simplified mark for 16px: thicker headphone band and larger ear cups so it stays legible in the toolbar.

## Method

Headless Chromium through Playwright (no npm dependency is added to the repo). For each output:

1. Set the viewport to at least the canvas size with a device pixel ratio of 1.
2. `page.setContent()` with a transparent `<body style="margin:0;background:transparent">` holding an `<img>` whose `src` is the SVG as a `data:image/svg+xml` URL, sized to the mark size and offset by the padding.
3. `page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })`.

Example script (run with `npx -y playwright@latest` installed browsers, or paste the function body into a Playwright MCP `browser_run_code` call):

```js
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 300, height: 300 }, deviceScaleFactor: 1 });
    const big = fs.readFileSync('icons/icon.svg', 'utf8');
    const small = fs.readFileSync('icons/icon-small.svg', 'utf8');
    const jobs = [
        ['icons/icon16.png', small, 16, 0],
        ['icons/icon32.png', big, 32, 0],
        ['icons/icon48.png', big, 48, 0],
        ['icons/icon128.png', big, 128, 0],
        ['store-assets/store-icon-128.png', big, 128, 16]
    ];
    for (const [file, svg, size, pad] of jobs) {
        const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" style="display:block;margin:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px"></body></html>`);
        await page.waitForFunction(() => document.images[0].complete);
        await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    }
    await browser.close();
})();
```

Afterwards check that each PNG header reports the exact width and height (bytes 16 to 23 of the file) and colour type 6 (RGBA).
