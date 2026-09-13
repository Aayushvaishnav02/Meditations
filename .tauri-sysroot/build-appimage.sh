#!/bin/bash
# Populate the Tauri AppDir with the webkit dependency closure from the
# sysroot, then run linuxdeploy manually (bundler can't see non-system libs).
set -e
BASE="$(cd "$(dirname "$0")" && pwd)"
SR="$BASE/root"
CACHE="$BASE/cache/tauri"
APPPARENT="$BASE/../frontend/src-tauri/target/release/bundle/appimage"
APPDIR="$APPPARENT/Meditations.AppDir"

[ -d "$APPDIR" ] || { echo "AppDir missing - run the tauri build first"; exit 1; }
mkdir -p "$APPDIR/usr/lib"

BIN="$APPDIR/usr/bin/app"
[ -f "$BIN" ] || BIN="$APPDIR/app"

# glibc-family libs must never be bundled into an AppImage
is_base_lib() {
  case "$(basename "$1")" in
    libc.so*|libm.so*|libdl.so*|libpthread.so*|librt.so*|ld-linux*|\
    libresolv.so*|libnss_*.so*|libnsl.so*|libutil.so*|libanl.so*) return 0 ;;
    *) return 1 ;;
  esac
}

copied=0
for lib in $(ldd "$BIN" | awk '/=> \//{print $3}'); do
  is_base_lib "$lib" && continue
  cp -L "$lib" "$APPDIR/usr/lib/" 2>/dev/null || { echo "SKIP $lib"; continue; }
  copied=$((copied+1))
done
echo "COPIED $copied libs"

# webkit helper processes + injected bundle (bundler hardcodes /usr/lib64)
mkdir -p "$APPDIR/usr/lib64/webkit2gtk-4.1/injected-bundle"
cp -a "$SR/usr/lib64/webkit2gtk-4.1/WebKitNetworkProcess" \
      "$SR/usr/lib64/webkit2gtk-4.1/WebKitWebProcess" \
      "$APPDIR/usr/lib64/webkit2gtk-4.1/" 2>/dev/null || true
cp -a "$SR/usr/lib64/webkit2gtk-4.1/injected-bundle/libwebkit2gtkinjectedbundle.so" \
      "$APPDIR/usr/lib64/webkit2gtk-4.1/injected-bundle/" 2>/dev/null || true
echo "HELPERS COPIED"

# Pre-strip with the host strip: linuxdeploy's bundled strip is too old for
# the .relr.dyn sections produced by current binutils
strip --strip-unneeded "$BIN" 2>/dev/null || true
find "$APPDIR/usr/lib" "$APPDIR/usr/lib64" -type f \( -name '*.so*' -o -name 'WebKit*' \) \
  -exec strip --strip-unneeded {} \; 2>/dev/null
echo "STRIPPED"

cd "$APPPARENT"
export PATH="$SR/usr/bin:$PATH"
export PKG_CONFIG_PATH="$SR/usr/lib64/pkgconfig:$SR/usr/share/pkgconfig"
export LD_LIBRARY_PATH="$SR/usr/lib64"
export APPIMAGE_EXTRACT_AND_RUN=1
export OUTPUT="$APPPARENT/Meditations_0.1.0_amd64.AppImage"
export ARCH=x86_64
"$CACHE/linuxdeploy-x86_64.AppImage" --appimage-extract-and-run --verbosity 1 \
  --appdir "$APPDIR" --plugin gtk --output appimage
echo "APPIMAGE_OK"
