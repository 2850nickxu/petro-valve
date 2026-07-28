#!/usr/bin/env bash
# scripts/new-agent-worktree.sh <slug> [base] — isolated workspace for an agent.
#
# Each agent gets its OWN git worktree on its OWN branch, so parallel agents can
# never touch the same working files or index — no clobbering. Example:
#
#   scripts/new-agent-worktree.sh add-csv-parser
#     → branch  agent/add-csv-parser
#     → dir     ../offline-po-app-worktrees/add-csv-parser   (clean, from origin/main)
#
# Point the agent at the printed directory. When it commits there, the
# post-commit hook ships that branch through the pipeline on its own.
set -euo pipefail

SLUG_RAW="${1:-}"
BASE="${2:-origin/main}"
[ -n "$SLUG_RAW" ] || { echo "usage: $0 <slug> [base-ref]"; exit 1; }

# Sanitise into a safe branch/dir component.
SLUG="$(printf '%s' "$SLUG_RAW" | tr ' /' '--' | tr -cd 'a-zA-Z0-9._-')"
[ -n "$SLUG" ] || { echo "error: slug '$SLUG_RAW' has no usable characters"; exit 1; }

ROOT="$(git rev-parse --show-toplevel)"
REPO="$(basename "$ROOT")"
BRANCH="agent/$SLUG"
DIR="$(dirname "$ROOT")/${REPO}-worktrees/$SLUG"

if [ -e "$DIR" ]; then echo "error: $DIR already exists"; exit 1; fi
if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "error: branch $BRANCH already exists"; exit 1
fi

git -C "$ROOT" fetch origin main -q || true
git -C "$ROOT" worktree add -b "$BRANCH" "$DIR" "$BASE"

echo "✅ Isolated worktree ready:"
echo "   branch : $BRANCH"
echo "   dir    : $DIR"
echo "   base   : $BASE ($(git -C "$ROOT" rev-parse --short "$BASE"))"
echo
echo "Next: run the agent in $DIR. On commit it auto-ships via .githooks/post-commit."
echo "When merged, clean up with:  git worktree remove \"$DIR\""
