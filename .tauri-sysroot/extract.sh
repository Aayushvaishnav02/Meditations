#!/bin/bash
# Extract x86_64/noarch RPMs into a local sysroot and repoint .pc prefixes
BASE="$(cd "$(dirname "$0")" && pwd)"
RPMS="$BASE/rpms"
ROOT="$BASE/root"
mkdir -p "$ROOT"

extracted=0
failed=0
for f in "$RPMS"/*.rpm; do
  case "$(basename "$f")" in *i686*|*i386*) continue ;; esac  # skip 32-bit
  # RPMs ship dirs like /usr/bin as 0555; make existing tree writable and keep umask
  find "$ROOT" -type d ! -perm -u+w -exec chmod u+w {} + 2>/dev/null
  if rpm2archive "$f" 2>/dev/null | tar -xzf - -C "$ROOT" --no-same-owner --no-same-permissions; then
    extracted=$((extracted+1))
  else
    echo "FAILED: $(basename "$f")"
    failed=$((failed+1))
  fi
done
echo "EXTRACTED $extracted rpms, $failed failed"

# Prune bulky runtime data not needed for compiling/linking
rm -rf "$ROOT/usr/share/fonts" "$ROOT/usr/share/icons" "$ROOT/usr/share/locale" \
       "$ROOT/usr/share/doc" "$ROOT/usr/share/man" "$ROOT/usr/share/help" \
       "$ROOT/usr/share/licenses" "$ROOT/usr/share/gnome-help" "$ROOT/usr/share/wayland-sessions"
echo "PRUNED"

# Repoint absolute prefix paths in pkg-config files at the sysroot
find "$ROOT/usr" -name '*.pc' -exec sed -i -E "s|(=)/usr|\1$ROOT/usr|g; s|(=)/etc|\1$ROOT/etc|g" {} +
echo "PC_REWRITTEN"
