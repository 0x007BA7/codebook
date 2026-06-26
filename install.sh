#!/usr/bin/env bash
#
# codebook installer.  Run:
#
#     curl -fsSL https://raw.githubusercontent.com/rzlim08/codebook/main/install.sh | bash
#
# What it does (no compilation, no root):
#   1. checks for git, node >= 20, npm (does NOT install them — see the hints)
#   2. clones the repo into  ~/.local/share/codebook  (re-runs just update it)
#   3. installs runtime deps with  npm ci --omit=dev   (~37 MB, prebuilt only)
#   4. symlinks  codebook  and  cb  into  ~/.local/bin
#
# Tunables (env vars):
#   CODEBOOK_HOME      where the source lives   (default ~/.local/share/codebook)
#   CODEBOOK_BIN_DIR   where the launchers go   (default ~/.local/bin)
#   CODEBOOK_REF       branch / tag / commit to install (default main)
#   CODEBOOK_REPO      git URL to clone from
#
# To uninstall:
#   rm -rf ~/.local/share/codebook ~/.local/bin/codebook ~/.local/bin/cb
#
# The whole script is wrapped in main() and only invoked on the last line, so a
# truncated `curl | bash` download executes nothing (same trick rustup/uv use).
set -euo pipefail

main() {
  REPO_URL="${CODEBOOK_REPO:-https://github.com/rzlim08/codebook.git}"
  REF="${CODEBOOK_REF:-main}"
  HOME_DIR="${CODEBOOK_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/codebook}"
  BIN_DIR="${CODEBOOK_BIN_DIR:-$HOME/.local/bin}"

  # --- pretty output (only when attached to a terminal) --------------------
  if [ -t 1 ]; then
    B="$(printf '\033[1m')"; R="$(printf '\033[0m')"
    GRN="$(printf '\033[32m')"; YEL="$(printf '\033[33m')"; RED="$(printf '\033[31m')"
  else
    B=""; R=""; GRN=""; YEL=""; RED=""
  fi
  say()  { printf '%s==>%s %s\n' "$GRN" "$R" "$*"; }
  warn() { printf '%swarning:%s %s\n' "$YEL" "$R" "$*" >&2; }
  die()  { printf '%serror:%s %s\n' "$RED" "$R" "$*" >&2; exit 1; }
  have() { command -v "$1" >/dev/null 2>&1; }

  # --- prerequisites -------------------------------------------------------
  # We deliberately do NOT install a toolchain. codebook runs TypeScript
  # directly via tsx/esbuild (prebuilt binaries), so there is no build step —
  # but it does need a Node runtime, npm to fetch deps, and git (the tool
  # itself operates on git repositories).
  if ! have git; then
    die "git not found. Install it first:
    macOS:  xcode-select --install   (or: brew install git)
    Linux:  sudo apt install git     (or your distro's package manager)"
  fi
  if ! have node; then
    die "Node.js not found (need 20+). codebook needs a Node runtime — install one:
    macOS:  brew install node
    nvm:    nvm install 20   (https://github.com/nvm-sh/nvm)
    or download from https://nodejs.org/"
  fi
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${NODE_MAJOR:-0}" -lt 20 ] 2>/dev/null; then
    die "Node $(node -v 2>/dev/null) is unsupported; codebook needs Node 20+ (18 is EOL).
    Upgrade via 'brew upgrade node', 'nvm install 20', or https://nodejs.org/"
  fi
  if ! have npm; then
    die "npm not found (it ships with Node). Reinstall Node, or add npm to your PATH."
  fi
  say "prerequisites ok: git, $(node -v), npm $(npm -v)"

  # --- fetch / update the source -------------------------------------------
  # One code path for fresh + update, and for branch / tag / commit alike:
  # init (if needed) -> shallow fetch the requested ref -> detach onto it.
  # A bad ref fails loudly here; we never silently fall back to another ref.
  if [ -e "$HOME_DIR" ] && [ ! -d "$HOME_DIR/.git" ]; then
    die "$HOME_DIR exists but is not a codebook git checkout.
    Move it aside, or set CODEBOOK_HOME to a different path, then re-run."
  fi
  if [ -d "$HOME_DIR/.git" ]; then
    say "updating existing install at ${B}$HOME_DIR${R} (ref: $REF)…"
  else
    say "installing into ${B}$HOME_DIR${R} from ${B}$REPO_URL${R} (ref: $REF)…"
    mkdir -p "$HOME_DIR"
    git -C "$HOME_DIR" init -q
  fi
  git -C "$HOME_DIR" remote remove origin 2>/dev/null || true
  git -C "$HOME_DIR" remote add origin "$REPO_URL"
  if ! git -C "$HOME_DIR" fetch -q --depth 1 origin "$REF"; then
    die "could not fetch ref '$REF' from $REPO_URL.
    Check the ref name / commit and your network. (Fetching an arbitrary commit
    requires it to be reachable on the remote.)"
  fi
  git -C "$HOME_DIR" checkout -q --detach FETCH_HEAD \
    || die "failed to check out the fetched ref."

  # --- install runtime dependencies (prebuilt; no compiler needed) ---------
  # --omit=dev = runtime only (no vitest/eslint/vite/typescript). `npm ci` is
  # reproducible from the lockfile; if the lock is missing OR out of sync with
  # package.json (npm ci hard-fails on a mismatch), fall back to npm install so
  # a stale lock can't brick the install. Do NOT pass --ignore-scripts: esbuild's
  # postinstall places its prebuilt platform binary and the tool won't run without it.
  say "installing runtime dependencies (~37 MB, one time)…"
  (
    cd "$HOME_DIR"
    # Quiet the ci attempt: on a no/stale lock it prints a long EUSAGE dump that
    # looks fatal but isn't — we fall back. A real failure still surfaces via the
    # npm install error and the die below.
    npm ci --omit=dev --no-fund --no-audit --loglevel=error 2>/dev/null \
      || { warn "npm ci unusable (missing or stale lockfile) — falling back to npm install."
           npm install --omit=dev --no-fund --no-audit --loglevel=error; }
  ) || die "dependency install failed. Re-run, or 'cd $HOME_DIR && npm install --omit=dev' to see why."

  # --- put the launchers on PATH -------------------------------------------
  LAUNCHER="$HOME_DIR/bin/codebook"
  [ -f "$LAUNCHER" ] || die "launcher missing at $LAUNCHER (unexpected — bad checkout?)."
  chmod +x "$LAUNCHER"
  mkdir -p "$BIN_DIR"
  ln -sf "$LAUNCHER" "$BIN_DIR/codebook"
  ln -sf "$LAUNCHER" "$BIN_DIR/cb"
  say "linked ${B}codebook${R} and ${B}cb${R} -> $BIN_DIR"

  # --- optional external tools (not install-blocking) ----------------------
  have sem || warn "the 'sem' CLI is not installed — needed for real diffs/PRs.
    install it:  brew install sem-cli   (or: npm i -g @ataraxy-labs/sem)
    (the built-in examples work without it:  codebook --fixture rate-limit)"
  have gh  || warn "GitHub 'gh' CLI is not installed — needed only for the 'codebook <PR-number>' form.
    install it:  https://cli.github.com"

  # --- final word: PATH ----------------------------------------------------
  echo
  case ":$PATH:" in
    *":$BIN_DIR:"*)
      say "${GRN}done.${R} try it:  ${B}codebook --fixture rate-limit${R}"
      ;;
    *)
      # Guess the right profile file. macOS Terminal starts a *login* bash that
      # reads ~/.bash_profile, not ~/.bashrc; zsh reads ~/.zshrc on both.
      case "${SHELL:-}" in
        */zsh)  PROFILE="~/.zshrc" ;;
        */bash) [ "$(uname -s)" = "Darwin" ] && PROFILE="~/.bash_profile" || PROFILE="~/.bashrc" ;;
        *)      PROFILE="your shell profile" ;;
      esac
      say "${GRN}installed,${R} but ${B}$BIN_DIR${R} is not on your PATH yet."
      printf '    add this to %s and restart your shell:\n\n' "$PROFILE"
      printf '      %sexport PATH="%s:$PATH"%s\n\n' "$B" "$BIN_DIR" "$R"
      printf '    then run:  %scodebook --fixture rate-limit%s\n' "$B" "$R"
      ;;
  esac
}

main "$@"
