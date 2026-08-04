#!/usr/bin/env bash
# Render every mockup in src/ to a 2x PNG in png/.
# Size comes from an optional "window-width:NNN window-height:NNN" comment in each file.
# Needs a Chromium headless shell. Override with CHROME=/path/to/binary.
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell}"
if [ ! -x "$CHROME" ]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

mkdir -p png
for f in src/*.html; do
  name=$(basename "$f" .html)
  w=$(grep -o 'window-width:[0-9]*'  "$f" | head -1 | cut -d: -f2 || true); w=${w:-1440}
  h=$(grep -o 'window-height:[0-9]*' "$f" | head -1 | cut -d: -f2 || true); h=${h:-900}
  "$CHROME" --headless --disable-gpu --hide-scrollbars --no-sandbox \
    --force-device-scale-factor=2 --window-size="$w","$h" \
    --screenshot="png/$name.png" "file://$PWD/$f" >/dev/null 2>&1
  echo "rendered $name (${w}x${h} @2x)"
done

# Flat UI screenshots quantise to a 256-colour palette with no visible loss,
# which roughly thirds the size of the Word document that embeds them.
python3 optimise.py
