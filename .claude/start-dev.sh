#!/bin/bash
unset NODE_OPTIONS
cd "$(dirname "$0")/.."
exec node --no-warnings node_modules/vite/bin/vite.js --port 3007
