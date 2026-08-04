#!/usr/bin/env bash
# Build OpenOKR-Overview.docx from the markdown source and the rendered mockups.
# Needs pandoc and python3. Re-run after editing OpenOKR-Overview.md or the mockups.
set -euo pipefail
cd "$(dirname "$0")"

WORK=".build"
rm -rf "$WORK"; mkdir -p "$WORK/ref" "$WORK/out"

# 1. Restyle pandoc's default reference document.
pandoc --print-default-data-file reference.docx > "$WORK/ref-default.docx"
( cd "$WORK/ref" && unzip -o -q ../ref-default.docx )
python3 style-reference.py "$WORK/ref"
( cd "$WORK/ref" && zip -q -r -X ../reference.docx '[Content_Types].xml' _rels docProps word )

# 2. Convert.
pandoc OpenOKR-Overview.md \
  --from markdown+raw_attribute \
  --to docx \
  --reference-doc "$WORK/reference.docx" \
  --resource-path=. \
  --output "$WORK/raw.docx"

# 3. Fit table columns to their content and repeat header rows across pages.
( cd "$WORK/out" && unzip -o -q ../raw.docx )
python3 fit-tables.py "$WORK/out"
rm -f OpenOKR-Overview.docx
( cd "$WORK/out" && zip -q -r -X -D ../../OpenOKR-Overview.docx . -x '.*' )

rm -rf "$WORK"
echo "wrote $(pwd)/OpenOKR-Overview.docx"
