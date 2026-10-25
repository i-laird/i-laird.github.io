#!/usr/bin/env bash
# Render the resume PDF to the image the room's desk shows (room.js:
# RESUME_IMG) — the real page, via macOS Quick Look. Re-run after replacing
# the PDF; it also records the PDF's hash so test/resume-render.test.js can
# fail when the PDF changes and the image doesn't.
set -euo pipefail
cd "$(dirname "$0")/.."
PDF=assets/documents/ianclaird_resume.pdf
OUT=assets/documents/ianclaird_resume.jpg
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
qlmanage -t -s 1700 -o "$tmp" "$PDF" >/dev/null 2>&1
sips -s format jpeg -s formatOptions 40 "$tmp/$(basename "$PDF").png" --out "$OUT" >/dev/null
shasum -a 256 "$PDF" | cut -d' ' -f1 > scripts/resume-render.sha256
echo "rendered $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
