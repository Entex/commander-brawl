#!/bin/sh
# Installs or updates Commander Brawl for the current user, on macOS or Linux. Run it again to update.
#
#   curl -fsSL https://github.com/Entex/commander-brawl/releases/latest/download/install.sh | sh
#
# Or install an archive you already have:
#
#   sh install.sh commander-brawl-darwin-arm64.tar.gz
#
# The previous version is kept, so a bad update can be undone with: sh install.sh --rollback
set -eu

REPO="${CB_REPO:-Entex/commander-brawl}"

say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --progress-bar -o "$2" "$1" || fail "Could not download $1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --show-progress -O "$2" "$1" || fail "Could not download $1"
  else
    fail "Neither curl nor wget is installed."
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

case "$(uname -s)" in
  Linux) platform=linux ;;
  Darwin) platform=darwin ;;
  *) fail "This script is for macOS and Linux. On Windows, use install.ps1." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "Unsupported processor: $(uname -m)" ;;
esac
if [ "$platform" = linux ] && [ "$arch" != x64 ]; then
  fail "Only 64-bit Intel/AMD Linux is supported for now."
fi
asset="commander-brawl-$platform-$arch.tar.gz"

if [ "$platform" = darwin ]; then
  app="$HOME/Applications/Commander Brawl.app"
  root="$HOME/Library/Application Support/Commander Brawl Installer"
else
  root="${XDG_DATA_HOME:-$HOME/.local/share}/commander-brawl"
  app="$root/app"
fi
previous="$root/previous"

stop_running_app() {
  if pgrep -f "$app" >/dev/null 2>&1; then
    say "Closing Commander Brawl…"
    pkill -f "$app" || true
    sleep 2
  fi
}

if [ "${1:-}" = "--rollback" ]; then
  [ -d "$previous" ] || fail "There is no previous version to go back to."
  stop_running_app
  rm -rf "$root/rollback"
  mv "$app" "$root/rollback"
  mv "$previous" "$app"
  mv "$root/rollback" "$previous"
  say "Went back to Commander Brawl $(cat "$app/app-version" 2>/dev/null || cat "$app/Contents/Resources/app-version" 2>/dev/null || echo '(previous version)')."
  exit 0
fi

mkdir -p "$root"
staging="$root/staging"
rm -rf "$staging"
mkdir -p "$staging"
trap 'rm -rf "$staging"' EXIT

if [ $# -ge 1 ]; then
  case "$1" in
    http://* | https://*) download "$1" "$staging/$asset" ;;
    *) [ -f "$1" ] || fail "No such file: $1"; cp "$1" "$staging/$asset" ;;
  esac
else
  base="https://github.com/$REPO/releases/latest/download"
  say "Downloading Commander Brawl…"
  download "$base/$asset" "$staging/$asset"
  download "$base/SHA256SUMS" "$staging/SHA256SUMS"
  expected=$(grep " $asset\$" "$staging/SHA256SUMS" | cut -d' ' -f1)
  [ -n "$expected" ] || fail "The release has no checksum for $asset."
  [ "$(sha256 "$staging/$asset")" = "$expected" ] || fail "The download is damaged (checksum mismatch). Try again."
fi

tar -xzf "$staging/$asset" -C "$staging" || fail "Could not unpack $asset."
new="$staging/commander-brawl"
version=$(cat "$new/app-version" 2>/dev/null || echo unknown)

if [ "$platform" = darwin ]; then
  bundle="$new/Commander Brawl.app"
  [ -d "$bundle" ] || fail "The archive doesn't contain the app."
  cp "$new/app-version" "$bundle/Contents/Resources/app-version"
  # Downloaded files are marked as "from the internet", which makes macOS refuse unsigned apps.
  # This is our own app, so remove the mark and sign it for this computer only (no Apple account needed).
  xattr -cr "$bundle"
  codesign --force --deep --sign - "$bundle" >/dev/null 2>&1 || fail "Could not prepare the app (codesign failed)."
  stop_running_app
  mkdir -p "$HOME/Applications"
  rm -rf "$previous"
  [ -d "$app" ] && mv "$app" "$previous"
  mv "$bundle" "$app"
  say "Installed Commander Brawl $version in ~/Applications."
  say "macOS asks for camera and local network access the first time; allow both."
else
  [ -x "$new/commander-brawl" ] || fail "The archive doesn't contain the app."
  stop_running_app
  rm -rf "$previous"
  [ -d "$app" ] && mv "$app" "$previous"
  mv "$new" "$app"

  bin="$HOME/.local/bin"
  mkdir -p "$bin"
  cat >"$bin/commander-brawl" <<EOF
#!/bin/sh
exec "$app/commander-brawl" "\$@"
EOF
  chmod +x "$bin/commander-brawl"

  applications="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$applications"
  cat >"$applications/commander-brawl.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Commander Brawl
Comment=Play Magic: The Gathering Commander over webcams
Exec="$app/commander-brawl" %U
Categories=Game;CardGame;
Terminal=false
EOF

  say "Installed Commander Brawl $version. Start it from your app menu or run: commander-brawl"
  case ":$PATH:" in *":$bin:"*) ;; *) say "(Add $bin to your PATH to start it from a terminal.)" ;; esac
  if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = 1 ]; then
    say ""
    say "Note: this system (likely Ubuntu 24.04 or newer) blocks the browser sandbox that Commander Brawl uses."
    say "If the app doesn't start, allow it once with:"
    say "  sudo chown root \"$app/chrome-sandbox\" && sudo chmod 4755 \"$app/chrome-sandbox\""
  fi
fi
