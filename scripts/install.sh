#!/usr/bin/env bash
# Symlink `codebook` (and a short `cb` alias) onto the PATH so it can be run
# from any repo. Pick the first writable, sensible bin dir; fall back to ~/.local/bin.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$PROJECT_DIR/bin/codebook"

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
ln -sf "$SRC" "$BINDIR/codebook"
ln -sf "$SRC" "$BINDIR/cb"
echo "installed: $BINDIR/codebook (and 'cb' alias) -> $SRC"

case ":$PATH:" in
  *":$BINDIR:"*) echo "ready: run 'codebook <PR-number>' (or 'cb …') from inside any cloned repo." ;;
  *) echo "NOTE: $BINDIR is not on your PATH. Add this to your shell profile:"
     echo "      export PATH=\"$BINDIR:\$PATH\""
     exit 1 ;;
esac
