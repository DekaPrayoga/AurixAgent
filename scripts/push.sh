#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git push "$@"
bash scripts/deploy.sh
