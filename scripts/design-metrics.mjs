#!/usr/bin/env node
/**
 * Design-system consistency metrics.
 *
 * Prints the KPI table from the design audit so progress is measurable rather
 * than a matter of opinion. Run `npm run design:metrics` after any styling
 * work; every number should trend toward its target, never away.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SKIP = new Set(["node_modules", "dist", ".next", ".claude", "build", ".git"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(join(ROOT, "app"));
const css = files.filter((f) => f.endsWith(".css"));
const tsx = files.filter((f) => f.endsWith(".tsx"));
const read = (f) => readFileSync(f, "utf8");
const allCss = css.map(read).join("\n");
const allTsx = tsx.map(read).join("\n");

const matches = (src, re) => src.match(re) ?? [];
const unique = (list) => [...new Set(list)];

/* --- Type scale ---------------------------------------------------------- */
const fontSizes = matches(allCss, /font-size:\s*[^;}!]+/g).map((d) =>
  d.split(":").slice(1).join(":").trim(),
);
const tokenSizes = fontSizes.filter((v) => v.startsWith("var(--fs-"));
const literalSizes = fontSizes.filter((v) => /^[\d.]+(px|rem|em)$/.test(v));
// `font-size:0` is the idiom for hiding a letter while keeping it for screen
// readers (the form-guide dots do this), so it is not illegible text.
//
// `em` is skipped: it resolves against the *parent's* size, which this script
// cannot know, so there is no rendered size to compare against the floor. It
// was previously measured with the `rem` threshold, i.e. as though every parent
// were 16px, which reported `.fraction{font-size:.47em}` (a maths fraction that
// scales with its formula and renders well above 11px) as a 7.5px violation.
// A false positive here is worse than a miss: it invites someone to "fix"
// correct CSS. em values still count toward the distinct-literal row above.
const tinyType = literalSizes.filter((v) => {
  const n = parseFloat(v);
  if (n === 0 || v.endsWith("em")) return false;
  return v.endsWith("px") ? n < 11 : n < 0.6875;
});

/* --- Spacing scale --------------------------------------------------------
   padding/margin/gap (and directional variants) split into their individual
   values, same idea as font-size: how much of it is var(--sp-*) vs a literal
   number that happens to land exactly on one of the six scale steps. */
const spacingProps =
  "padding|margin|gap|row-gap|column-gap|padding-inline|padding-block|margin-inline|margin-block|" +
  "padding-top|padding-bottom|padding-left|padding-right|margin-top|margin-bottom|margin-left|margin-right|" +
  "padding-inline-start|padding-inline-end";
const spacingDeclarations = matches(
  allCss,
  new RegExp(`(?<![a-zA-Z-])(?:${spacingProps}):[^;{}]+`, "g"),
).map((d) => d.split(":").slice(1).join(":").trim());
const spacingValues = spacingDeclarations.flatMap((v) =>
  v.replace(/!important\s*$/, "").trim().split(/\s+/),
);
const spacingTokenValues = spacingValues.filter((v) => v.startsWith("var(--sp-"));
const spacingLiteralValues = spacingValues.filter((v) => /^[\d.]+(px|rem)$/.test(v));
const ON_SCALE = new Set([
  "4px", ".25rem", "6px", ".375rem", "8px", ".5rem", "10px", ".625rem",
  "12px", ".75rem", "14px", ".875rem", "16px", "1rem", "20px", "1.25rem",
  "24px", "1.5rem", "28px", "1.75rem", "32px", "2rem",
]);
const spacingOffScale = spacingLiteralValues.filter((v) => !ON_SCALE.has(v));

/* --- Shape and elevation --------------------------------------------------
   Same idea as type and spacing: border-radius, box-shadow and transition
   are properties a user reads as "is this the same app?", and as of the
   phase 04 shape work they have their own token scale (--radius-sm/md/lg,
   plus the existing shadow and duration/easing tokens in tokens.css)
   but no lint gate of their own yet beyond the border-radius exact-match
   rule in .stylelintrc.json. These three rows exist to make that debt
   visible and trend it down, the same way the spacing rows did before the
   spacing rule existed. */
const radiusValues = matches(allCss, /border-radius\s*:\s*[^;}!]+/g).map((d) =>
  d.split(":").slice(1).join(":").trim(),
);
const radiusLiteralValues = radiusValues.filter((v) => !v.startsWith("var("));
const RADIUS_ON_SCALE = new Set([".75rem", "12px", "1rem", "16px", "1.25rem", "20px"]);
const radiusOffScale = radiusLiteralValues.filter((v) => !RADIUS_ON_SCALE.has(v));

const shadowValues = unique(
  matches(allCss, /box-shadow\s*:\s*[^;}!]+/g)
    .map((d) => d.split(":").slice(1).join(":").trim())
    .filter((v) => !v.startsWith("var(")),
);

const transitionValues = unique(
  matches(allCss, /(?<![a-zA-Z-])transition\s*:\s*[^;}!]+/g)
    .map((d) => d.split(":").slice(1).join(":").trim())
    .filter((v) => !v.startsWith("var(")),
);

/* --- Breakpoints --------------------------------------------------------- */
const breakpoints = unique(
  matches(allCss, /@media[^{]+/g)
    .flatMap((q) => matches(q, /(?:max|min)-width:\s*\d+px/g))
    .map((b) => b.replace(/\s+/g, "")),
);

/* --- Everything else ----------------------------------------------------- */
const globals = read(join(ROOT, "app", "globals.css"));
const rows = [
  ["不同字級數值種類", unique(literalSizes).length, 0, "寫死的字級應全數改用代幣"],
  ["字級走代幣比例", `${Math.round((tokenSizes.length / fontSizes.length) * 100)}%`, "100%", ""],
  ["不同斷點數", breakpoints.length, 5, "380 / 599 / 820 / 1180 / min-821"],
  ["!important 次數", matches(globals, /!important/g).length, 0, ""],
  ["寫死色碼數 (種類)", unique(matches(allCss, /#[0-9a-fA-F]{3,8}\b/g)).length, "< 20", ""],
  ["globals.css 行數", globals.split("\n").length, "< 500", ""],
  ["小於 11px 的字級", tinyType.length, 0, "低於此值手機上讀不清"],
  ["內嵌 style={{}}", matches(allTsx, /style=\{\{/g).length, 0, ""],
  [
    "間距走代幣比例",
    `${Math.round((spacingTokenValues.length / spacingValues.length) * 100)}%`,
    "100%",
    "",
  ],
  [
    "仍寫死但符合六階間距值",
    spacingLiteralValues.length - spacingOffScale.length,
    0,
    "數字對但沒用代幣，應直接替換",
  ],
  ["不同圓角數值種類", unique(radiusLiteralValues).length, "< 5", "寫死的圓角應全數改用代幣"],
  [
    "仍寫死但符合三階圓角值",
    radiusLiteralValues.length - radiusOffScale.length,
    0,
    "數字對但沒用代幣，應直接替換",
  ],
  ["不同陰影數值種類", shadowValues.length, "< 5", "寫死的陰影應全數改用代幣"],
  ["不同過場動畫數值種類", transitionValues.length, "< 5", "寫死的 transition 應全數改用代幣"],
];

const pad = (s, n) => String(s).padEnd(n);
const padStart = (s, n) => String(s).padStart(n);
console.log("\n  設計一致性指標  " + new Date().toISOString().slice(0, 10));
console.log("  " + "─".repeat(74));
console.log(`  ${pad("指標", 24)}${padStart("現況", 8)}${padStart("目標", 10)}   備註`);
console.log("  " + "─".repeat(74));
for (const [name, now, target, note] of rows) {
  console.log(`  ${pad(name, 24)}${padStart(now, 8)}${padStart(target, 10)}   ${note}`);
}
console.log("  " + "─".repeat(74));
console.log(`  斷點清單: ${breakpoints.sort().join("  ") || "(無)"}\n`);
