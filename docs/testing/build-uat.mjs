// Builds docs/testing/OpenOKR-UAT.xlsx from uat-cases.mjs.
//
//   node docs/testing/build-uat.mjs
//
// Writes the workbook XML by hand and zips it with Node's own zlib, so it
// needs no package at all. A dependency for a test document would be the one
// thing CLAUDE.md asks us not to add without asking.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { CASES, MODULES, PERSONAS } from "./uat-cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "OpenOKR-UAT.xlsx");

const STATUSES = ["Not Run", "Pass", "Fail", "Error", "Blocked", "N/A"];
const PRIORITIES = ["High", "Medium", "Low"];
const SEVERITIES = ["Critical", "Major", "Minor", "Cosmetic"];
const BUG_STATES = ["Open", "Fixed", "Retest", "Closed", "Won't fix"];

// ---------------------------------------------------------------- styles

// Cell style ids, matching the order of <cellXfs> below.
const S = {
  body: 1,
  header: 2,
  band: 3,
  title: 4,
  input: 5,
  pct: 6,
  bold: 7,
  boldPct: 8,
  text: 9,
  subtitle: 10,
  example: 11,
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0%"/></numFmts>
<fonts count="6">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><b/><sz val="16"/><color rgb="FF1F3864"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font>
<font><sz val="10"/><color rgb="FF595959"/><name val="Arial"/></font>
<font><i/><sz val="10"/><color rgb="FF7F7F7F"/><name val="Arial"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E1"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<dxfs count="5">
<dxf><font><b/><color rgb="FF006100"/></font><fill><patternFill><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf>
<dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>
<dxf><font><b/><color rgb="FF833C0B"/></font><fill><patternFill><bgColor rgb="FFF8CBAD"/></patternFill></fill></dxf>
<dxf><font><b/><color rgb="FF9C5700"/></font><fill><patternFill><bgColor rgb="FFFFEB9C"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF595959"/></font><fill><patternFill><bgColor rgb="FFE7E6E6"/></patternFill></fill></dxf>
</dxfs>
</styleSheet>`;

// ---------------------------------------------------------------- cells

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const colName = (n) => {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  }
  return s;
};

/** A cell: a string, a number, `{ f }` for a formula, or null for blank. */
const cellXml = (ref, value, style) => {
  const s = style ? ` s="${style}"` : "";
  if (value === null || value === undefined || value === "") {
    return style ? `<c r="${ref}"${s}/>` : "";
  }
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (typeof value === "object" && "f" in value) {
    return `<c r="${ref}"${s}><f>${esc(value.f)}</f></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
};

/**
 * One worksheet. `rows` is an array of { cells: [[value, style]...], height }.
 * Options: widths, freeze {row, col}, filter "A1:N9", validations
 * [{ sqref, list }], conditional [{ sqref, rules: [[text, dxf]] }], merges.
 */
const sheetXml = (rows, opt = {}) => {
  const parts = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
  ];
  if (opt.freeze) {
    const { row, col } = opt.freeze;
    const top = `${colName(col + 1)}${row + 1}`;
    const attrs = [
      col ? `xSplit="${col}"` : "",
      row ? `ySplit="${row}"` : "",
      `topLeftCell="${top}"`,
      `activePane="${row && col ? "bottomRight" : row ? "bottomLeft" : "topRight"}"`,
      `state="frozen"`,
    ].filter(Boolean);
    parts.push(
      `<sheetViews><sheetView workbookViewId="0" zoomScale="100"><pane ${attrs.join(" ")}/></sheetView></sheetViews>`,
    );
  } else {
    parts.push(`<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>`);
  }
  if (opt.widths) {
    parts.push(
      `<cols>${opt.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`,
    );
  }
  parts.push("<sheetData>");
  rows.forEach((row, r) => {
    const n = r + 1;
    const ht = row.height ? ` ht="${row.height}" customHeight="1"` : "";
    const cells = row.cells
      .map(([v, st], c) => cellXml(`${colName(c + 1)}${n}`, v, st))
      .join("");
    parts.push(`<row r="${n}"${ht}>${cells}</row>`);
  });
  parts.push("</sheetData>");
  if (opt.filter) parts.push(`<autoFilter ref="${opt.filter}"/>`);
  if (opt.merges?.length) {
    parts.push(
      `<mergeCells count="${opt.merges.length}">${opt.merges
        .map((m) => `<mergeCell ref="${m}"/>`)
        .join("")}</mergeCells>`,
    );
  }
  let priority = 1;
  for (const cf of opt.conditional ?? []) {
    const first = cf.sqref.split(":")[0];
    const rules = cf.rules
      .map(
        ([text, dxf]) =>
          `<cfRule type="containsText" dxfId="${dxf}" priority="${priority++}" operator="containsText" text="${esc(text)}"><formula>NOT(ISERROR(SEARCH("${esc(text)}",${first})))</formula></cfRule>`,
      )
      .join("");
    parts.push(`<conditionalFormatting sqref="${cf.sqref}">${rules}</conditionalFormatting>`);
  }
  if (opt.validations?.length) {
    parts.push(
      `<dataValidations count="${opt.validations.length}">${opt.validations
        .map(
          (v) =>
            `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.sqref}"><formula1>"${esc(v.list.join(","))}"</formula1></dataValidation>`,
        )
        .join("")}</dataValidations>`,
    );
  }
  parts.push(`<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>`);
  parts.push(`<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>`);
  parts.push("</worksheet>");
  return parts.join("");
};

// ---------------------------------------------------------------- sheets

const moduleLabel = (code) => {
  const found = MODULES.find(([c]) => c === code);
  if (!found) throw new Error(`Unknown module ${code}`);
  return `${found[0]} ${found[1]}`;
};

// Test Cases
const TC_HEAD = [
  "ID", "Module", "Test case", "Login as", "Pre-condition", "Steps",
  "Expected result", "Priority", "Hint for the tester", "Status",
  "Actual result / notes", "Tester", "Date", "Bug ID",
];
const tcRows = [{ cells: TC_HEAD.map((h) => [h, S.header]), height: 30 }];
const seq = {};
let lastModule = null;
for (const tc of CASES) {
  if (tc.module !== lastModule) {
    tcRows.push({
      cells: [[moduleLabel(tc.module), S.band], ...Array.from({ length: 13 }, () => [null, S.band])],
    });
    lastModule = tc.module;
  }
  seq[tc.module] = (seq[tc.module] ?? 0) + 1;
  const id = `${tc.module}-${String(seq[tc.module]).padStart(2, "0")}`;
  const steps = tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  tcRows.push({
    cells: [
      [id, S.body],
      [moduleLabel(tc.module), S.body],
      [tc.title, S.body],
      [tc.who, S.body],
      [tc.pre, S.body],
      [steps, S.body],
      [tc.expected, S.body],
      [tc.priority, S.body],
      [tc.hint, S.body],
      ["Not Run", S.input],
      [null, S.input],
      [null, S.input],
      [null, S.input],
      [null, S.input],
    ],
  });
}
const tcLast = tcRows.length;
const testCasesSheet = sheetXml(tcRows, {
  widths: [9, 22, 30, 15, 26, 48, 44, 9, 34, 11, 34, 12, 11, 10],
  freeze: { row: 1, col: 3 },
  filter: `A1:N${tcLast}`,
  validations: [
    { sqref: `J2:J${tcLast}`, list: STATUSES },
    { sqref: `H2:H${tcLast}`, list: PRIORITIES },
  ],
  conditional: [
    {
      sqref: `J2:J${tcLast}`,
      rules: [["Pass", 0], ["Fail", 1], ["Error", 2], ["Blocked", 3], ["N/A", 4]],
    },
  ],
});

// Summary
const TC = "'Test Cases'";
const sumHead = ["Module", "Cases", "Pass", "Fail", "Error", "Blocked", "N/A", "Not run", "Executed", "Pass rate"];
const sumRows = [
  { cells: [["Test summary", S.title]], height: 26 },
  { cells: [["Every number below is a formula over the Test Cases sheet. Set the Status column there and this page updates.", S.subtitle]] },
  { cells: [] },
  { cells: sumHead.map((h) => [h, S.header]), height: 22 },
];
const firstSum = sumRows.length + 1;
for (const [code] of MODULES) {
  const r = sumRows.length + 1;
  const cnt = (status) => ({ f: `COUNTIFS(${TC}!$B:$B,$A${r},${TC}!$J:$J,"${status}")` });
  sumRows.push({
    cells: [
      [moduleLabel(code), S.body],
      [{ f: `COUNTIF(${TC}!$B:$B,$A${r})` }, S.body],
      [cnt("Pass"), S.body],
      [cnt("Fail"), S.body],
      [cnt("Error"), S.body],
      [cnt("Blocked"), S.body],
      [cnt("N/A"), S.body],
      [{ f: `B${r}-SUM(C${r}:G${r})` }, S.body],
      [{ f: `C${r}+D${r}+E${r}` }, S.body],
      [{ f: `IF(I${r}=0,"",C${r}/I${r})` }, S.pct],
    ],
  });
}
const lastSum = sumRows.length;
const tot = sumRows.length + 1;
sumRows.push({
  cells: [
    ["Total", S.bold],
    ...["B", "C", "D", "E", "F", "G", "H", "I"].map((col) => [
      { f: `SUM(${col}${firstSum}:${col}${lastSum})` },
      S.bold,
    ]),
    [{ f: `IF(I${tot}=0,"",C${tot}/I${tot})` }, S.boldPct],
  ],
});
sumRows.push({ cells: [] });
sumRows.push({
  cells: [["Executed counts Pass, Fail and Error. Pass rate is Pass divided by Executed. Blocked and N/A are left out of the rate because nothing was judged. A blank Status counts as Not run.", S.subtitle]],
  height: 28,
});
const summarySheet = sheetXml(sumRows, {
  widths: [40, 9, 9, 9, 9, 9, 9, 9, 10, 11],
  merges: [`A2:J2`, `A${tot + 2}:J${tot + 2}`],
});

// Personas
const perRows = [
  { cells: [["Personas", S.title]], height: 26 },
  { cells: [["The Northwind Labs cast from the product's own demo story. Every test case names who to sign in as. Fill the yellow email column before M04: plus-addresses on one inbox work, for example qa.okr+priya@yourdomain.com", S.subtitle]], height: 30 },
  { cells: [] },
  { cells: ["Persona", "Full name", "Title", "Reports to", "Sign-in email (fill in)", "Password (fill in)", "Access and role in the test", "Used in"].map((h) => [h, S.header]), height: 22 },
];
for (const [key, name, title, boss, access, used] of PERSONAS) {
  perRows.push({
    cells: [
      [key, S.bold], [name, S.body], [title, S.body], [boss, S.body],
      [null, S.input], [null, S.input], [access, S.body], [used, S.body],
    ],
  });
}
perRows.push({ cells: [] });
perRows.push({ cells: [["Use one browser profile per persona (Chrome profiles, Firefox containers or separate browsers). It saves signing in and out, and it lets two people act at once in M13 and M15.", S.subtitle]], height: 30 });
const personasSheet = sheetXml(perRows, {
  widths: [11, 18, 26, 12, 30, 18, 52, 30],
  merges: ["A2:H2", `A${perRows.length}:H${perRows.length}`],
});

// Bug Log
const BUG_HEAD = [
  "Bug ID", "Test ID", "Module", "Title", "Severity", "Steps to reproduce",
  "Expected", "Actual", "Screenshot or video link", "Browser and device",
  "Reported by", "Date", "Status",
];
const bugRows = [{ cells: BUG_HEAD.map((h) => [h, S.header]), height: 30 }];
bugRows.push({
  cells: [
    ["BUG-001", S.example], ["M09-03", S.example], ["M09 Drafting OKRs and quality checks", S.example],
    ["Example row, replace it: OBJ-1 chip missing", S.example], ["Major", S.example],
    ["1. Open Cycle, phase 4\n2. Type Launch the new onboarding flow", S.example],
    ["OBJ-1 chip shows", S.example], ["No chip, meter stays green", S.example],
    ["https://link-to-screenshot", S.example], ["Chrome 140, Windows 11", S.example],
    ["Tester name", S.example], ["2026-09-25", S.example], ["Open", S.example],
  ],
});
for (let i = 0; i < 60; i++) {
  bugRows.push({ cells: BUG_HEAD.map(() => [null, S.input]) });
}
const bugSheet = sheetXml(bugRows, {
  widths: [9, 9, 22, 32, 10, 40, 30, 30, 26, 18, 14, 11, 10],
  freeze: { row: 1, col: 0 },
  filter: `A1:M${bugRows.length}`,
  validations: [
    { sqref: `E2:E${bugRows.length}`, list: SEVERITIES },
    { sqref: `M2:M${bugRows.length}`, list: BUG_STATES },
  ],
});

// Read Me
const para = (text, style = S.text, height) => ({ cells: [[text, style]], height });
const two = (a, b, sa = S.body, sb = S.body) => ({ cells: [[a, sa], [b, sb]] });
const readRows = [
  para("OpenOKR user acceptance test", S.title, 28),
  para("A step-by-step test of the whole product through its screens, done by a person. It follows the order the product is used in: install, invite the team, plan the cycle, draft and publish OKRs, run the week, close the quarter, then the integrations.", S.subtitle, 42),
  para(""),
  { cells: [["How to use this workbook", S.header], [null, S.header]] },
  two(1, "Start a fresh instance with an empty database (docs/install/compose.md). Note the URL."),
  two(2, "Fill the yellow email and password cells on the Personas sheet."),
  two(3, "Work down the Test Cases sheet in order. Each module builds on the one before it."),
  two(4, "Sign in as the person in \"Login as\". Check the Pre-condition, follow the Steps, compare with Expected result."),
  two(5, "Pick a Status from the dropdown. For anything other than Pass, write what you saw in \"Actual result / notes\"."),
  two(6, "For each Fail or Error, add a row on Bug Log with a screenshot link, and put its Bug ID on the test case."),
  two(7, "Read the Summary sheet for the totals. It updates by itself."),
  para(""),
  { cells: [["Status", S.header], ["When to use it", S.header]] },
  two("Not Run", "Not tested yet. Every case starts here."),
  two("Pass", "What you saw matches Expected result."),
  two("Fail", "The screen works but the result is different from Expected result. Wrong text, wrong number, missing item, a refusal that should not happen."),
  two("Error", "The app broke: an error page, \"We could not load\", a blank screen, a spinner that never ends, or a crash."),
  two("Blocked", "You could not run the test because something earlier failed, or a pre-condition cannot be met. Say which in the notes."),
  two("N/A", "Does not apply to this instance, for example no Slack workspace or no passkey device."),
  para(""),
  { cells: [["Before you start", S.header], [null, S.header]] },
  two("Browsers", "One browser profile per persona. Two screens help for M13 and M15, where two people act at once."),
  two("Email", "Without SMTP the instance prints every mail to its log. Invitation links are also shown once on Admin, Invitations. For reset links either read the server log or run Mailpit (SMTP on localhost port 1025, inbox at http://localhost:8025)."),
  two("Server access", "A few cases need someone who can read logs, restart the instance or run a pnpm command. They say so in the hint."),
  two("AI", "AI is off by default and everything before M20 is tested with it off. M20 needs a provider key with a spending limit."),
  two("Integrations", "M21 to M26 need outside accounts (Slack, Teams, WhatsApp, Telegram, an identity provider, an MCP client). Mark N/A for any you do not have."),
  two("Never", "Paste an API key, token or password into this workbook. Write where it is kept instead."),
  para(""),
  { cells: [["Known risks found while writing this", S.header], [null, S.header]] },
  two("Publishing", "Code review suggests gates 2 and 5 have no field in the UI. M11-05 tests it. If they cannot turn green, publish with the override in M11-07."),
  two("Sessions", "Sessions cannot be created from the UI. The only weekly session is the one the starter template makes in M02. Quarterly reviews may not be reachable at all (M18-06)."),
  two("Admins", "Only the first account has full access, and no screen grants it to anyone else."),
  two("Chat test", "\"Send me a test\" on Admin, Channels sends an email, not a chat message."),
  two("2FA", "There is no button to turn one-time codes off. Use the throwaway persona Amara."),
  para(""),
  para(`Generated from docs/testing/uat-cases.mjs. ${CASES.length} test cases across ${MODULES.length} modules.`, S.subtitle),
];
// Paragraphs and section headers span both columns.
const readMerges = [];
readRows.forEach((row, i) => {
  const single = row.cells.length === 1;
  const header = row.cells.length === 2 && row.cells[1][0] === null;
  if (single || header) {
    readMerges.push(`A${i + 1}:B${i + 1}`);
    if (single) row.cells.push([null, row.cells[0][1]]);
  }
});
const readMeSheet = sheetXml(readRows, { widths: [16, 110], merges: readMerges });

// ---------------------------------------------------------------- package

const SHEETS = [
  ["Read Me", readMeSheet],
  ["Summary", summarySheet],
  ["Personas", personasSheet],
  ["Test Cases", testCasesSheet],
  ["Bug Log", bugSheet],
];

const tcIndex = SHEETS.findIndex(([n]) => n === "Test Cases");
const bugIndex = SHEETS.findIndex(([n]) => n === "Bug Log");
const definedNames = [
  `<definedName name="_xlnm._FilterDatabase" localSheetId="${tcIndex}" hidden="1">'Test Cases'!$A$1:$N$${tcLast}</definedName>`,
  `<definedName name="_xlnm._FilterDatabase" localSheetId="${bugIndex}" hidden="1">'Bug Log'!$A$1:$M$${bugRows.length}</definedName>`,
].join("");

const files = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${SHEETS.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
  "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>OpenOKR user acceptance test</dc:title>
<dc:creator>OpenOKR</dc:creator>
</cp:coreProperties>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${SHEETS.map(([name], i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
<definedNames>${definedNames}</definedNames>
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${SHEETS.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${SHEETS.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  "xl/styles.xml": STYLES,
};
SHEETS.forEach(([, xml], i) => {
  files[`xl/worksheets/sheet${i + 1}.xml`] = xml;
});

/** A plain zip writer: deflate each entry, then the central directory. */
const zip = (entries) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // A fixed timestamp keeps the file byte-identical between runs.
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cdir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdir, end]);
};

writeFileSync(OUT, zip(files));
console.log(`Wrote ${OUT}: ${CASES.length} cases, ${MODULES.length} modules`);
