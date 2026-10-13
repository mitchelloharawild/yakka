#!/bin/sh
# Renders the PWA icons in public/ from the SVG sources in public/icons/.
# Requires rsvg-convert (librsvg). The PNGs are committed, so this only needs
# re-running when the artwork changes: `npm run icons`.
set -eu
cd "$(dirname "$0")/../public"

rsvg-convert -w 192 -h 192 icons/icon.svg -o icons/icon-192.png
rsvg-convert -w 512 -h 512 icons/icon.svg -o icons/icon-512.png
rsvg-convert -w 192 -h 192 icons/icon-maskable.svg -o icons/maskable-192.png
rsvg-convert -w 512 -h 512 icons/icon-maskable.svg -o icons/maskable-512.png
# iOS adds its own rounded corners and ignores transparency, so use the
# full-bleed artwork.
rsvg-convert -w 180 -h 180 icons/icon-maskable.svg -o apple-touch-icon.png
rsvg-convert -w 96 -h 96 icons/badge.svg -o icons/badge-96.png
echo "Icons written to public/"
