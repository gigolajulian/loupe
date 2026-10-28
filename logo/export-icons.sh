#!/bin/sh
# Renders logo/tray.svg and logo/app.svg to the PNGs LOUPE uses: icon.png (tray, 32 px),
# icon@2x.png (tray, 64 px), trayTemplate(@2x).png (Mac menu bar) and build/icon.png (512 px, electron-builder makes the .ico from it).
set -e
cd "$(dirname "$0")"
node icons.mjs
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
shot() { # svg, size, out
  printf '<html><body style="margin:0;background:transparent"><img src="%s" width="%s" height="%s"></body></html>' "$1" "$2" "$2" > _shot.html
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
    --window-size="$2,$2" --screenshot="$(cygpath -w "$PWD/$3")" "file:///$(cygpath -m "$PWD/_shot.html")" 2>/dev/null
}
mkdir -p ../build
shot tray.svg 32 ../icon.png
shot tray.svg 64 ../icon@2x.png
shot tray.svg 16 ../trayTemplate.png     # Mac menu bar, 16 pt
shot tray.svg 32 ../trayTemplate@2x.png
shot app.svg 512 ../build/icon.png
rm -f _shot.html
echo "icons written"
