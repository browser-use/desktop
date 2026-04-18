#!/bin/bash
set -euo pipefail
REPO="/Users/reagan/Documents/GitHub/desktop-app"
ISSUES=("$@")
TOTAL=${#ISSUES[@]}

for i in "${!ISSUES[@]}"; do
  ISSUE="${ISSUES[$i]}"
  IDX=$((i + 1))
  BRANCH="issue/${ISSUE}"
  WTDIR="/Users/reagan/Documents/GitHub/desktop-app-wt-${ISSUE}"

  echo "[$IDX/$TOTAL] Issue #$ISSUE → branch $BRANCH"

  cd "$REPO"
  git fetch origin main 2>/dev/null || true
  git worktree add "$WTDIR" -b "$BRANCH" origin/main 2>/dev/null || {
    git worktree remove "$WTDIR" --force 2>/dev/null || true
    git branch -D "$BRANCH" 2>/dev/null || true
    git worktree add "$WTDIR" -b "$BRANCH" origin/main
  }
  cd "$WTDIR"

  gh issue edit "$ISSUE" --add-label "status:in-progress" 2>/dev/null || true

  claude --model claude-opus-4-6 --dangerously-skip-permissions \
    "Implement GitHub issue #${ISSUE}. You are on branch ${BRANCH} in ${WTDIR}. Run: gh issue view ${ISSUE}. Read code, implement, run tsc --noEmit in my-app/, commit, rebase on origin/main, push with --force-with-lease, create PR with gh pr create. Then check CI with gh pr checks. Fix until green. Then /exit."

  gh issue edit "$ISSUE" --remove-label "status:in-progress" 2>/dev/null || true
  cd "$REPO"
  git worktree remove "$WTDIR" --force 2>/dev/null || true
  echo "[$IDX/$TOTAL] Finished issue #$ISSUE"
done
echo "=== All $TOTAL issues processed ==="
