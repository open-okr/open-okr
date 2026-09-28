// Draws the module workflow diagram from uat-guide.mjs and renders it to
// docs/testing/workflow.png, which build-uat.mjs places on the Read Me sheet.
//
//   node docs/testing/build-diagram.mjs
//
// Uses the Chromium that Playwright already installed for the end-to-end
// suite (pnpm test:e2e:install), so it adds nothing to the repository.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { MODULES } from "./uat-cases.mjs";
import { GUIDE, PHASES } from "./uat-guide.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Geometry. Two rows of three phase columns: 1-3 on top, 4-6 below.
const COL_W = 300;
const GAP_X = 56;
const BOX_H = 50;
const GAP_Y = 12;
const HEAD_H = 34;
const PAD = 28;
const ROW_GAP = 70;

const byPhase = Object.fromEntries(PHASES.map(([key]) => [key, []]));
for (const [code, name] of MODULES) {
  const g = GUIDE[code];
  if (!g) throw new Error(`No guide entry for ${code}`);
  byPhase[g.phase].push({ code, name, needs: g.needs });
}

const rows = [PHASES.slice(0, 3), PHASES.slice(3, 6)];
const colHeight = (key) => HEAD_H + byPhase[key].length * (BOX_H + GAP_Y) + 8;
const rowHeights = rows.map((row) => Math.max(...row.map(([key]) => colHeight(key))));
const width = PAD * 2 + COL_W * 3 + GAP_X * 2;
const titleH = 58;
const height = titleH + rowHeights[0] + ROW_GAP + rowHeights[1] + PAD + 26;

const colX = (i) => PAD + i * (COL_W + GAP_X);
const rowY = (r) => titleH + (r === 0 ? 0 : rowHeights[0] + ROW_GAP);

const parts = [];
parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
parts.push(`<text x="${PAD}" y="34" class="title">OpenOKR UAT: the order to test in</text>`);
parts.push(`<text x="${PAD}" y="52" class="sub">Phases 1 to 5 run top to bottom inside a column and left to right across. Integrations can start once the module under "needs" is done.</text>`);

rows.forEach((row, r) => {
  row.forEach(([key, label], i) => {
    const x = colX(i);
    const y = rowY(r);
    const optional = key === "connect";
    const h = rowHeights[r];
    parts.push(
      `<rect x="${x}" y="${y}" width="${COL_W}" height="${h}" rx="10" class="${optional ? "lane-opt" : "lane"}"/>`,
    );
    parts.push(`<text x="${x + 14}" y="${y + 22}" class="phase">${esc(label)}</text>`);
    byPhase[key].forEach((m, k) => {
      const by = y + HEAD_H + k * (BOX_H + GAP_Y);
      parts.push(
        `<rect x="${x + 10}" y="${by}" width="${COL_W - 20}" height="${BOX_H}" rx="6" class="${optional ? "box-opt" : "box"}"/>`,
      );
      parts.push(`<text x="${x + 22}" y="${by + 21}" class="code">${m.code}</text>`);
      parts.push(`<text x="${x + 62}" y="${by + 21}" class="name">${esc(m.name)}</text>`);
      const needs = m.needs.length ? `needs ${m.needs.join(", ")}` : "start here";
      parts.push(`<text x="${x + 62}" y="${by + 38}" class="needs">${esc(needs)}</text>`);
      if (!optional && k > 0) {
        const ax = x + 36;
        parts.push(`<path d="M${ax} ${by - GAP_Y + 1} L${ax} ${by - 1}" class="arrow" marker-end="url(#tip)"/>`);
      }
    });
  });
});

// Arrows between phases: 1 to 2 to 3 across the top, 3 down and back to 4,
// then 4 to 5 across the bottom.
const midTop = rowY(0) + 20;
const midBottom = rowY(1) + 20;
for (const i of [0, 1]) {
  parts.push(
    `<path d="M${colX(i) + COL_W + 4} ${midTop} L${colX(i + 1) - 6} ${midTop}" class="flow" marker-end="url(#big)"/>`,
  );
}
const downFrom = colX(2) + COL_W / 2;
const turnY = rowY(0) + rowHeights[0] + ROW_GAP / 2;
parts.push(
  `<path d="M${downFrom} ${rowY(0) + rowHeights[0] + 4} L${downFrom} ${turnY} L${colX(0) + COL_W / 2} ${turnY} L${colX(0) + COL_W / 2} ${rowY(1) - 6}" class="flow" fill="none" marker-end="url(#big)"/>`,
);
parts.push(
  `<path d="M${colX(0) + COL_W + 4} ${midBottom} L${colX(1) - 6} ${midBottom}" class="flow" marker-end="url(#big)"/>`,
);

parts.push(
  `<text x="${PAD}" y="${height - 14}" class="sub">Solid boxes: the core product, tested with AI off. Dashed: needs an outside account or server access, mark N/A if you have none.</text>`,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#7f8fa6"/></marker>
<marker id="big" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#1f3864"/></marker>
<style>
text { font-family: Arial, Helvetica, sans-serif; }
.title { font-size: 20px; font-weight: bold; fill: #1f3864; }
.sub { font-size: 12px; fill: #595959; }
.phase { font-size: 14px; font-weight: bold; fill: #1f3864; }
.code { font-size: 13px; font-weight: bold; fill: #1f3864; }
.name { font-size: 13px; fill: #1a1a1a; }
.needs { font-size: 11px; fill: #6b6b6b; }
.lane { fill: #eef4fb; stroke: #c5d6ea; }
.lane-opt { fill: #f6f6f6; stroke: #bfbfbf; stroke-dasharray: 6 4; }
.box { fill: #ffffff; stroke: #8eaadb; }
.box-opt { fill: #ffffff; stroke: #a6a6a6; stroke-dasharray: 4 3; }
.arrow { stroke: #7f8fa6; stroke-width: 1.5; }
.flow { stroke: #1f3864; stroke-width: 2.5; fill: none; }
</style>
</defs>
${parts.join("\n")}
</svg>`;

writeFileSync(join(here, "workflow.svg"), svg);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 2,
});
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await page.screenshot({ path: join(here, "workflow.png"), clip: { x: 0, y: 0, width, height } });
await browser.close();
console.log(`Wrote workflow.svg and workflow.png (${width}x${height} at 2x)`);
