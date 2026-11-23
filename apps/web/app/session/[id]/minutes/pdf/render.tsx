/**
 * Turning the minutes' Markdown into a PDF (P4-T12-a).
 *
 * **A deliberately small Markdown reader.** It handles the four shapes
 * `minutesToMarkdown` produces and nothing else: a title, section headings, list
 * items and paragraphs. A general Markdown parser would be a second dependency
 * for a document this file already knows the shape of, and anything it could not
 * render would be a section silently missing from a record.
 *
 * Bold markers are stripped rather than styled. Emphasis inside a list item is
 * the Markdown's way of separating a name from a sentence, and a PDF with the
 * asterisks left in reads as a bug.
 */
import { join } from "node:path";
import { serverTranslate } from "@openokr/core";
import { directionFor, intlTagFor } from "@openokr/formats";
import {
  Document,
  Font,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

const PDF_FONTS = join(process.cwd(), "public", "fonts", "pdf");
Font.register({
  family: "Noto Sans SC",
  src: join(PDF_FONTS, "NotoSansSC-Regular.otf"),
});
Font.register({
  family: "Noto Sans Arabic",
  src: join(PDF_FONTS, "NotoSansArabic-Regular.ttf"),
});
Font.registerHyphenationCallback(
  (word: string, fallback?: (word: string) => string[]) =>
    /\p{Script=Han}/u.test(word)
      ? Array.from(word)
      : (fallback?.(word) ?? [word]),
);

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 52 },
  title: { fontSize: 18, marginBottom: 14 },
  heading: { fontSize: 12, marginTop: 16, marginBottom: 6 },
  item: { fontSize: 9.5, marginBottom: 4, lineHeight: 1.45 },
  paragraph: { fontSize: 9.5, marginBottom: 8, lineHeight: 1.45 },
  // Continuation lines of a two-line list item, indented so the answer reads as
  // belonging to the question above it.
  continuation: {
    fontSize: 9.5,
    marginBottom: 4,
    marginLeft: 12,
    lineHeight: 1.45,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 52,
    right: 52,
    fontSize: 8,
    color: "#6b7280",
  },
});

const plain = (line: string) => line.replace(/\*\*/g, "");

type BlockKind = "title" | "heading" | "item" | "continuation" | "paragraph";

function minutesBlocks(markdown: string) {
  const blocks: { readonly kind: BlockKind; readonly text: string }[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ kind: "title", text: plain(line.slice(2)) });
    } else if (line.startsWith("## ")) {
      blocks.push({ kind: "heading", text: plain(line.slice(3)) });
    } else if (line.startsWith("- ")) {
      blocks.push({ kind: "item", text: `• ${plain(line.slice(2))}` });
    } else if (raw.startsWith("  ")) {
      // The second line of a management-retro answer.
      blocks.push({ kind: "continuation", text: plain(line.trim()) });
    } else {
      blocks.push({ kind: "paragraph", text: plain(line) });
    }
  }
  return blocks;
}

export async function renderMinutesPdf(
  markdown: string,
  locale: string,
): Promise<Buffer> {
  const direction = directionFor(locale);
  const fontFamily =
    locale === "zh-Hans"
      ? "Noto Sans SC"
      : locale === "ar"
        ? "Noto Sans Arabic"
        : "Helvetica";
  const number = new Intl.NumberFormat(intlTagFor(locale));
  return renderToBuffer(
    <Document>
      <Page size="A4" style={{ ...styles.page, direction, fontFamily }} wrap>
        <View>
          {minutesBlocks(markdown).map(({ kind, text }, index) => (
            // The source document is static during a render.
            // biome-ignore lint/suspicious/noArrayIndexKey: document line order is fixed
            <Text key={index} style={{ ...styles[kind], direction }}>
              {text}
            </Text>
          ))}
        </View>
        <Text
          style={{ ...styles.footer, direction }}
          render={({ pageNumber, totalPages }) =>
            serverTranslate(locale, "minutes.pageOf", {
              page: number.format(pageNumber),
              total: number.format(totalPages),
            })
          }
          fixed
        />
      </Page>
    </Document>,
  );
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);

export function renderMinutesPrintView({
  markdown,
  title,
  locale,
  nonce,
}: {
  readonly markdown: string;
  readonly title: string;
  readonly locale: string;
  readonly nonce: string | null;
}): string {
  const blocks = minutesBlocks(markdown).map(({ kind, text }) => {
    const tag = kind === "title" ? "h1" : kind === "heading" ? "h2" : "p";
    return `<${tag} class="${kind}">${escapeHtml(text)}</${tag}>`;
  });
  const nonceAttribute = nonce ? ` nonce="${escapeHtml(nonce)}"` : "";
  const print = escapeHtml(serverTranslate(locale, "minutes.print"));

  // The installed PDF renderer drops parts of Arabic glyphs. The browser shapes the same
  // minutes text offline with the bundled font.
  return `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${directionFor(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/fonts/noto-sans-arabic/fonts.css">
  <style${nonceAttribute}>
    @page { size: A4; margin: 16mm; }
    body { margin: 2rem auto; max-inline-size: 44rem; padding-inline: 1rem; font: 1rem/1.55 "Noto Sans Arabic", system-ui, sans-serif; }
    h1 { font-size: 1.5rem; }
    h2 { margin-block: 1.2rem 0.35rem; font-size: 1.1rem; break-after: avoid; }
    p { margin: 0 0 0.3rem; overflow-wrap: anywhere; }
    .continuation { padding-inline-start: 1rem; }
    #print { font: inherit; }
    @media print { body { margin: 0; padding: 0; max-inline-size: none; } #print { display: none; } }
  </style>
</head>
<body>
  ${nonce ? `<button type="button" id="print">${print}</button>` : ""}
  <main>${blocks.join("\n")}</main>
  ${nonce ? `<script${nonceAttribute}>document.getElementById("print").addEventListener("click", async () => { await document.fonts.ready; window.print(); });</script>` : ""}
</body>
</html>`;
}
