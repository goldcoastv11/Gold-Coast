#!/usr/bin/env bash
# Creates an isolated git worktree for a background agent, with node_modules
# linked so builds and tests run in it.
#
# Why this exists: the Agent tool's built-in `isolation: "worktree"` does not
# work in this project (it requires the session's working directory to BE the
# git repo, and here the session root is one level above `casino-poc`). Doing
# it by hand was three commands repeated for every agent, and forgetting the
# node_modules symlinks fails in a confusing way several minutes later.
#
# Usage:  scripts/new-agent-worktree.sh <name> [branch]
# Prints the worktree path on success - hand that to the agent.
set -euo pipefail

NAME="${1:?usage: new-agent-worktree.sh <name> [branch]}"
BRANCH="${2:-roadmap/$NAME}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${AGENT_WORKTREE_DIR:-$(dirname "$REPO")/.agent-worktrees}"
DEST="$BASE/$NAME"

cd "$REPO"

if [ -e "$DEST" ]; then
  echo "error: $DEST already exists - pick another name or remove it first" >&2
  exit 1
fi

git worktree prune
mkdir -p "$BASE"
git worktree add "$DEST" -b "$BRANCH" >/dev/null

# Linked, not copied: a real install per worktree is slow and wastes gigabytes.
ln -s "$REPO/node_modules" "$DEST/node_modules"
ln -s "$REPO/server/node_modules" "$DEST/server/node_modules"

echo "$DEST"
