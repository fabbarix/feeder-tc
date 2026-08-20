#!/usr/bin/env bash
# Regenerate every raster app icon from the three SVG masters in public/.
#
#   ./scripts/generate-icons.sh
#
# Requires ImageMagick 7 built against librsvg (`magick -list format | grep RSVG`).
# ImageMagick's own MSVG renderer is not good enough — check that RSVG is listed
# before trusting the output.
#
# Why -density and not just -resize: ImageMagick rasterises an SVG at its natural
# size first (a 64-unit viewBox at the default 96dpi is 64x64 px) and only then
# resizes. Without -density you are upscaling a 64px bitmap to 512px and the
# result is soft. Density is therefore scaled per target: 96 * size / 64.
#
# Sources: public/logo.svg is BOTH a master and a served asset (it is the SVG
# favicon). assets/logo/*.svg are build-time sources only — they must not live in
# public/ or Vite would copy two unused files into dist/.
#
# Regenerate and commit the PNGs whenever a logo SVG changes. They are checked
# in deliberately: the build must not depend on ImageMagick being installed.

set -euo pipefail
cd "$(dirname "$0")/.."
OUT=public

render() { # render <src.svg> <size> <dest.png>
  local src=$1 size=$2 dest=$3
  local density=$((96 * size / 64))
  magick -background none -density "$density" "$src" -resize "${size}x${size}" "$dest"
}

echo "==> browser tab / favicon"
# .ico still matters: bookmark bars, older Windows browsers, and anything that
# ignores the SVG icon. Multi-resolution, so each context picks its own size.
for s in 16 32 48; do render "$OUT/logo.svg" "$s" "/tmp/feeder-ico-$s.png"; done
magick /tmp/feeder-ico-16.png /tmp/feeder-ico-32.png /tmp/feeder-ico-48.png "$OUT/favicon.ico"
rm -f /tmp/feeder-ico-*.png
render "$OUT/logo.svg" 96 "$OUT/favicon-96.png"

echo "==> android / chrome (purpose: any)"
render "$OUT/logo.svg" 192 "$OUT/icon-192.png"
render "$OUT/logo.svg" 512 "$OUT/icon-512.png"

echo "==> android (purpose: maskable)"
# Separate master with a full-bleed background and a 62%-scaled glyph, so nothing
# is clipped when the OS crops to a circle. See logo-maskable.svg.
render "assets/logo/logo-maskable.svg" 192 "$OUT/icon-maskable-192.png"
render "assets/logo/logo-maskable.svg" 512 "$OUT/icon-maskable-512.png"

echo "==> ios (apple-touch-icon)"
# 180x180 is the size current iPhones use. iOS composites over black, so the
# alpha channel is stripped rather than left to chance — a transparent corner
# would render as a black corner.
render "assets/logo/logo-apple.svg" 180 "$OUT/apple-touch-icon.png"
magick "$OUT/apple-touch-icon.png" -background '#1c9b5e' -alpha remove -alpha off \
  "$OUT/apple-touch-icon.png"

echo
echo "Generated:"
ls -1 "$OUT"/favicon.ico "$OUT"/favicon-96.png "$OUT"/icon-*.png "$OUT"/apple-touch-icon.png
