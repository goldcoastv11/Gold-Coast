#!/usr/bin/env bash
# Removes an agent worktree created by new-agent-worktree.sh.
# Usage: scripts/rm-agent-worktree.sh <name>
set -euo pipefail
NAME="${1:?usage: rm-agent-worktree.sh <name>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${AGENT_WORKTREE_DIR:-$(dirname "$REPO")/.agent-worktrees}"
cd "$REPO"
# --force because the symlinked node_modules always reads as untracked clutter.
git worktree remove --force "$BASE/$NAME" 2>/dev/null || true
rm -rf "$BASE/$NAME" 2>/dev/null || true
git worktree prune
echo "removed $NAME"
