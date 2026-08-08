/**
 * Rasterise the link-preview banners into `public/`.
 *
 * WhatsApp's crawler does not render SVG, so `og:image` has to be a JPEG. Rather than hand-drawing
 * one in an image editor and letting it drift from the app's own palette, the banner is defined in
 * `lib/story-card.ts` alongside the story card and rasterised here with the Chromium that Playwright
 * already provides. Run it whenever the banner design changes; the output is committed, because a
 * link preview must not depend on a build step that a deployment might skip.
 *
 *   node --experimental-strip-types scripts/render-share-images.mjs
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BANNER_HEIGHT, BANNER_WIDTH, shareBannerSvg } from "../lib/story-card.ts";

const targets = [
  { kind: "match", file: "match-share.jpg" },
  { kind: "record", file: "record-share.jpg" },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: BANNER_WIDTH, height: BANNER_HEIGHT }, deviceScaleFactor: 1 });
for (const target of targets) {
  const svg = shareBannerSvg(target.kind);
  await page.setContent(`<style>html,body{margin:0;padding:0}</style>${svg}`, { waitUntil: "load" });
  const buffer = await page.screenshot({ type: "jpeg", quality: 88 });
  const out = fileURLToPath(new URL(`../public/${target.file}`, import.meta.url));
  await writeFile(out, buffer);
  console.log(`wrote public/${target.file} (${buffer.length} bytes)`);
}
await browser.close();
