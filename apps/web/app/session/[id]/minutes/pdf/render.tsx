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
import {
  Document,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type React from "react";

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

export async function renderMinutesPdf(markdown: string): Promise<Buffer> {
  const lines = markdown.split("\n");
  const blocks: React.ReactElement[] = [];
  let key = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      continue;
    }
    key += 1;
    if (line.startsWith("# ")) {
      blocks.push(
        <Text key={key} style={styles.title}>
          {plain(line.slice(2))}
        </Text>,
      );
    } else if (line.startsWith("## ")) {
      blocks.push(
        <Text key={key} style={styles.heading}>
          {plain(line.slice(3))}
        </Text>,
      );
    } else if (line.startsWith("- ")) {
      blocks.push(
        <Text key={key} style={styles.item}>
          {`• ${plain(line.slice(2))}`}
        </Text>,
      );
    } else if (raw.startsWith("  ")) {
      // The second line of a management-retro answer.
      blocks.push(
        <Text key={key} style={styles.continuation}>
          {plain(line.trim())}
        </Text>,
      );
    } else {
      blocks.push(
        <Text key={key} style={styles.paragraph}>
          {plain(line)}
        </Text>,
      );
    }
  }

  return renderToBuffer(
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View>{blocks}</View>
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>,
  );
}
