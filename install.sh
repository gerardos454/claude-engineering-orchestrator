#!/usr/bin/env bash
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.claude/agents"
if [[ "${1:-}" == "--global" ]]; then
  DEST="$HOME/.claude/agents"
elif [[ "${1:-}" == "--project" && -n "${2:-}" ]]; then
  DEST="${2%/}/.claude/agents"
else
  echo "Usage: bash install.sh --global | --project /path/to/repo" >&2
  exit 2
fi
mkdir -p "$DEST"
cp -R "$SRC"/. "$DEST"/
echo "Installed Claude engineering agents to: $DEST"
echo "If this was the first agents directory created during a running Claude Code session, restart that session once."
