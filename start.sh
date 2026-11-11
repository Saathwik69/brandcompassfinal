#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 from https://nodejs.org/ first.'
  exit 1
fi
node -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or newer is required.');process.exit(1)}"
exec node --env-file-if-exists=.env server.mjs
