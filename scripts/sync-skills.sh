#!/usr/bin/env bash
# One canonical skill directory (.opencode/skills); .agents/skills and .claude/skills are symlink views of it,
# so Codex, OpenCode and Claude Code see the same skills.
set -euo pipefail
cd "$(dirname "$0")/.."
for view in .agents/skills .claude/skills; do
  mkdir -p "$view"
  for dir in .opencode/skills/*/; do
    name=$(basename "$dir")
    [ -e "$view/$name" ] || ln -s "../../.opencode/skills/$name" "$view/$name"
  done
done
echo "skills synced"
