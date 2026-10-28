#!/usr/bin/env bash
# No copying or harness-specific skill catalogs. Configure the harness to load this path.
set -euo pipefail
cd "$(dirname "$0")/.."
printf '%s\n' "$PWD/skills"
