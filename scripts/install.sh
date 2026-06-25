#!/usr/bin/env bash
# Symlink `prl-review` onto the PATH so it can be run from any repo.
# Pick the first writable, sensible bin dir; fall back to ~/.local/bin.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$PROJECT_DIR/pr-spine.sh"
NAME="prl-review"

chmod +x "$SRC"

pick_bindir() {
  if [ -n "${PREFIX:-}" ]; then echo "$PREFIX"; return; fi
  for d in /usr/local/bin /opt/homebrew/bin "$HOME/.local/bin"; do
    if [ -d "$d" ] && [ -w "$d" ]; then echo "$d"; return; fi
  done
  echo "$HOME/.local/bin"
}

BINDIR="$(pick_bindir)"
mkdir -p "$BINDIR"
DEST="$BINDIR/$NAME"

ln -sf "$SRC" "$DEST"
echo "installed: $DEST -> $SRC"

case ":$PATH:" in
  *":$BINDIR:"*) echo "ready: run 'prl-review <PR-number>' from inside any cloned repo." ;;
  *) echo "NOTE: $BINDIR is not on your PATH. Add this to your shell profile:"
     echo "      export PATH=\"$BINDIR:\$PATH\"" ;;
esac
