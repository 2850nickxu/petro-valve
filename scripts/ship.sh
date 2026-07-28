#!/usr/bin/env bash
# scripts/ship.sh — deterministic "push → PR → gate → merge → production" pipeline.
#
# Takes the CURRENT worktree's branch all the way to Vercel production:
#   push branch → open/refresh PR → wait for CI + Vercel preview to go green
#   → (auto-)merge to main → watch the production deploy.
#
# Designed to be launched detached by .githooks/post-commit, invoked by the
# `devops` subagent, or run by hand. It NEVER runs on main, is idempotent (safe
# to re-run — reuses an existing PR), and refuses to merge unless every check is
# green. Full-auto merge is the default; set SHIP_AUTOMERGE=0 to stop at a green
# PR and let a human merge.
set -euo pipefail

export DEVOPS_SHIP_RUNNING=1   # re-entrancy guard read by the post-commit hook

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SLUG="${BRANCH//\//-}"
DEVOPS_DIR="$ROOT/.devops"
mkdir -p "$DEVOPS_DIR"
LOG="$DEVOPS_DIR/ship-$SLUG.log"
FAIL="$DEVOPS_DIR/FAILED-$SLUG.md"
LOCK="$DEVOPS_DIR/ship-$SLUG.lock"
AUTOMERGE="${SHIP_AUTOMERGE:-1}"

log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }
die() {
  log "❌ $*"
  { echo "# Ship failed: \`$BRANCH\`"; echo
    echo "$*"; echo
    echo "Full log: \`.devops/ship-$SLUG.log\`"
  } > "$FAIL"
  exit 1
}

# --- guards -----------------------------------------------------------------
case "$BRANCH" in
  main|master|HEAD)
    log "On '$BRANCH' — nothing to ship (main is the deploy target). Exiting."
    exit 0 ;;
esac

# Single-flight: mkdir is atomic, so two concurrent runs can't both proceed.
if ! mkdir "$LOCK" 2>/dev/null; then
  log "A ship run is already in progress for '$BRANCH' ($LOCK). Exiting."
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

command -v gh >/dev/null 2>&1 || die "gh CLI not found — install GitHub CLI."
gh auth status >/dev/null 2>&1 || die "gh is not authenticated — run: gh auth login"

# --- 1. push ----------------------------------------------------------------
log "🚀 Shipping '$BRANCH' → pushing to origin…"
git push -u origin "$BRANCH" >>"$LOG" 2>&1 || die "git push failed (see log)."

# --- 2. open or reuse the PR ------------------------------------------------
if gh pr view "$BRANCH" >/dev/null 2>&1; then
  PR="$(gh pr view "$BRANCH" --json number -q .number)"
  log "Reusing existing PR #$PR."
else
  TITLE="$(git log -1 --pretty=%s)"
  gh pr create --base main --head "$BRANCH" --title "$TITLE" \
    --body $'Automated pipeline PR for `'"$BRANCH"$'`.\n\nMerges to main (→ production) once CI **and** the Vercel preview are green.' \
    >>"$LOG" 2>&1 || die "gh pr create failed (see log)."
  PR="$(gh pr view "$BRANCH" --json number -q .number)"
  log "Opened PR #$PR."
fi
PR_URL="$(gh pr view "$PR" --json url -q .url)"
log "PR: $PR_URL"

# --- 3. wait for checks to register, then watch to completion ---------------
log "Waiting for checks (CI + Vercel preview) to register…"
for _ in $(seq 1 30); do
  out="$(gh pr checks "$PR" 2>&1 || true)"
  case "$out" in
    *"no checks reported"*|*"no checks"*) sleep 10 ;;
    *) break ;;
  esac
done

log "Watching checks (this blocks until they finish)…"
if gh pr checks "$PR" --watch --fail-fast --interval 15 >>"$LOG" 2>&1; then
  log "✅ All checks green."
else
  { echo "# Checks failed: \`$BRANCH\`"; echo
    echo "PR: $PR_URL"; echo
    echo '```'; gh pr checks "$PR" 2>&1 || true; echo '```'
  } > "$FAIL"
  die "CI/preview checks failed — NOT merging. Details in .devops/FAILED-$SLUG.md and on the PR."
fi

# --- 4. merge (full-auto) or stop for manual merge --------------------------
if [ "$AUTOMERGE" != "1" ]; then
  rm -f "$FAIL"
  log "SHIP_AUTOMERGE=0 → PR #$PR is green; leaving it for a manual merge. Done."
  log "   Merge with: gh pr merge $PR --squash --delete-branch"
  exit 0
fi

log "Merging PR #$PR (squash) → main → production deploy…"
gh pr merge "$PR" --squash --delete-branch >>"$LOG" 2>&1 \
  || die "Merge failed (conflict with main?). Resolve on the PR, then re-run."

# --- 5. watch the production (Vercel) deploy on main ------------------------
OWNER_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
MAIN_SHA="$(gh api "repos/$OWNER_REPO/commits/main" -q .sha)"
log "Merged. Watching production deploy for main@${MAIN_SHA:0:7}…"

STATUS_API="repos/$OWNER_REPO/commits/$MAIN_SHA/status"
for _ in $(seq 1 60); do   # ~15 min ceiling
  state="$(gh api "$STATUS_API" -q '[.statuses[] | select(.context=="Vercel")][0].state // .state' 2>/dev/null || echo pending)"
  url="$(gh api "$STATUS_API" -q '[.statuses[] | select(.context=="Vercel")][0].target_url // ""' 2>/dev/null || echo '')"
  case "$state" in
    success)
      rm -f "$FAIL"
      log "✅ Production deploy succeeded.${url:+ $url}"
      log "🎉 Shipped '$BRANCH' → main → production."
      exit 0 ;;
    failure|error)
      { echo "# Production deploy FAILED after merge: \`$BRANCH\`"; echo
        echo "main@$MAIN_SHA"; echo "${url:-(no Vercel URL)}"
      } > "$FAIL"
      die "Production deploy failed.${url:+ $url}" ;;
    *) sleep 15 ;;
  esac
done

log "⚠️  Merged to main, but the production deploy did not report success within the watch window."
log "   Check Vercel: https://vercel.com/  (project: offline-po-app)"
exit 0
