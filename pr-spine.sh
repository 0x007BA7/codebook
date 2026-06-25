#!/usr/bin/env bash
#
# prl-review — turn a PR into a reading-spine HTML page and open it.
#
# Typical use (after `make install` in the prl-linearizer repo):
#   cd /path/to/some/clone
#   gh pr checkout 1234          # check out the PR branch
#   prl-review 1234              # opens the reading spine for that PR
#
# Other forms:
#   prl-review                   # review the current branch vs its base (no PR #)
#   prl-review --base origin/main --head HEAD
#   prl-review <repo-dir> [--base <ref>] [--head <ref>]
#   prl-review --fixture rate-limit   # built-in example, no sem/gh needed
#   prl-review 1234 --out review.html # write to a file instead of a temp file
#
# Requires: node, npm. PRs also require `sem` (brew install sem-cli);
# the PR-number form also requires GitHub `gh`.
set -euo pipefail

# --- resolve our real location even when invoked via a symlink (make install) ---
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  D="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$D/$SOURCE"
done
PROJECT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
CLI="$PROJECT_DIR/packages/cli/src/main.ts"
INVOKE_DIR="$PWD"

die() { echo "error: $*" >&2; exit 1; }
opener() { case "$(uname -s)" in Darwin) open "$1";; *) xdg-open "$1" 2>/dev/null || echo "open: $1";; esac; }

# --- parse args -------------------------------------------------------------
PR="" REPO="" FIXTURE="" BASE="" HEAD="HEAD" OUT="" NO_OPEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fixture) FIXTURE="${2:-}"; shift 2;;
    --base)    BASE="${2:-}"; shift 2;;
    --head)    HEAD="${2:-}"; shift 2;;
    --out)     OUT="${2:-}"; shift 2;;
    --no-open) NO_OPEN=1; shift;;
    -h|--help) sed -n '2,30p' "$0"; exit 0;;
    -*)        die "unknown flag: $1";;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then PR="$1"; else REPO="$1"; fi
      shift;;
  esac
done

# relative --out resolves against the dir you ran us from
if [ -n "$OUT" ]; then case "$OUT" in /*) ;; *) OUT="$INVOKE_DIR/$OUT";; esac; fi

# --- prerequisites ----------------------------------------------------------
command -v node >/dev/null 2>&1 || die "node not found. Install Node.js 18+."
command -v npm  >/dev/null 2>&1 || die "npm not found."
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "==> installing prl-linearizer dependencies (first run)…"
  ( cd "$PROJECT_DIR" && npm install )
fi

# --- fixture mode (no sem/gh) ----------------------------------------------
if [ -n "$FIXTURE" ]; then
  OUT="${OUT:-$PROJECT_DIR/$FIXTURE-spine.html}"
  ( cd "$PROJECT_DIR" && npx tsx "$CLI" render --fixture "$FIXTURE" --out "$OUT" )
  [ -n "$NO_OPEN" ] || { echo "==> opening $OUT"; opener "$OUT"; }
  exit 0
fi

# --- determine the repo checkout -------------------------------------------
REPO="${REPO:-$INVOKE_DIR}"
REPO="$(cd "$REPO" 2>/dev/null && pwd)" || die "repo dir not found: $REPO"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo: $REPO"

command -v sem >/dev/null 2>&1 || die "the 'sem' CLI is required for real PRs.
  install it:  brew install sem-cli   (or: npm i -g @ataraxy-labs/sem)
  (or try '--fixture rate-limit' to see the UI without sem)."

# --- PR-number mode: review the PR's ACTUAL head, regardless of current branch.
# We check out the PR head into a throwaway git worktree (your branch + WIP are
# untouched) so both `sem diff` and `sem graph` see the right code state. --------
ORIG_REPO="$REPO"
if [ -n "$PR" ]; then
  command -v gh >/dev/null 2>&1 || die "GitHub 'gh' CLI is required for the PR-number form.
  install it (https://cli.github.com) and run 'gh auth login', or pass --base/--head yourself."
  echo "==> looking up PR #$PR via gh…"
  if ! read -r BASE_BRANCH HEAD_BRANCH HEAD_OID < <(cd "$ORIG_REPO" && \
      gh pr view "$PR" --json baseRefName,headRefName,headRefOid \
        -q '[.baseRefName,.headRefName,.headRefOid]|@tsv' 2>/dev/null); then
    die "could not read PR #$PR via gh (is gh authenticated for this repo?)."
  fi
  [ -n "${HEAD_OID:-}" ] || die "could not resolve PR #$PR head commit."
  echo "==> fetching PR #$PR head ($HEAD_BRANCH @ ${HEAD_OID:0:9})…"
  git -C "$ORIG_REPO" rev-parse --verify --quiet "$HEAD_OID^{commit}" >/dev/null 2>&1 \
    || git -C "$ORIG_REPO" fetch -q origin "pull/$PR/head" 2>/dev/null || true
  git -C "$ORIG_REPO" rev-parse --verify --quiet "$HEAD_OID^{commit}" >/dev/null 2>&1 \
    || die "could not fetch PR head commit $HEAD_OID."
  git -C "$ORIG_REPO" rev-parse --verify --quiet "origin/$BASE_BRANCH" >/dev/null 2>&1 \
    || git -C "$ORIG_REPO" fetch -q origin "$BASE_BRANCH" 2>/dev/null || true
  BASE="$(git -C "$ORIG_REPO" merge-base "origin/$BASE_BRANCH" "$HEAD_OID" 2>/dev/null || echo "origin/$BASE_BRANCH")"
  HEAD="$HEAD_OID"
  WT="${TMPDIR:-/tmp}/prl-wt-$PR"
  git -C "$ORIG_REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
  echo "==> checking out PR head into a temp worktree (your branch is untouched)…"
  git -C "$ORIG_REPO" worktree add --detach -q "$WT" "$HEAD_OID" || die "failed to create worktree at $WT"
  cleanup_wt() { git -C "$ORIG_REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true; }
  trap cleanup_wt EXIT
  REPO="$WT"
  OUT="${OUT:-${TMPDIR:-/tmp}/prl-pr-$PR.html}"
  echo "==> PR #$PR: base $BASE_BRANCH (${BASE:0:9}) .. head ${HEAD_OID:0:9}"
  echo "    (first run on a large repo can take ~a minute while sem indexes the worktree)"
fi

# --- no PR #, no base given: auto-detect base from the remote's default branch ---
if [ -z "$BASE" ]; then
  DEF="$(git -C "$REPO" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)"
  DEF="${DEF#refs/remotes/}"; DEF="${DEF:-origin/main}"
  if git -C "$REPO" rev-parse --verify --quiet "$DEF" >/dev/null; then
    BASE="$(git -C "$REPO" merge-base "$DEF" "$HEAD" 2>/dev/null || echo "$DEF")"
    echo "==> base auto-detected: $DEF (merge-base $BASE)"
  else
    die "could not auto-detect the base branch. Pass it explicitly: --base <ref>."
  fi
fi

OUT="${OUT:-$REPO/pr-spine.html}"
echo "==> linearizing $REPO  ($BASE..$HEAD) via sem…"
RENDER_ARGS=(render --repo "$REPO" --base "$BASE" --head "$HEAD" --ingestor sem --out "$OUT")
if [ -n "$PR" ]; then
  RENDER_ARGS+=(--title "PR #$PR — ${HEAD_BRANCH:-head}")
fi
( cd "$PROJECT_DIR" && SEM_NO_TELEMETRY=1 npx tsx "$CLI" "${RENDER_ARGS[@]}" )
[ -n "$NO_OPEN" ] || { echo "==> opening $OUT"; opener "$OUT"; }
