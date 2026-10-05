#!/bin/sh
# Builds what the screens page loads: the icons, the plugin's stylesheet, the bundle.
set -e
H=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$H/../.." && pwd)
cd "$H"
[ -d node_modules ] || npm install --silent
[ -f icons.js ] || node -e "
const fs = require('fs'), dir = 'node_modules/lucide-static/icons', icons = {}
for (const f of fs.readdirSync(dir)) if (f.endsWith('.svg')) icons[f.slice(0, -4)] = fs.readFileSync(dir + '/' + f, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim()
fs.writeFileSync('icons.js', 'window.ICONS=' + JSON.stringify(icons) + ';')
"
cd "$ROOT" && node -e "
const { bundle } = require('lightningcss')
require('fs').writeFileSync('$H/plugin.css', bundle({ filename: 'src/styles/index.css' }).code)
"
cd "$H"
ALIAS="--alias:yaml=$ROOT/node_modules/yaml --log-level=error"
./node_modules/.bin/esbuild entry.ts --bundle --outfile=bundle.js --alias:obsidian=./stub.ts --define:__STYLEGUIDE__=false $ALIAS
./node_modules/.bin/esbuild pdfs.ts --bundle --platform=node --format=cjs --outfile=pdfs.cjs --alias:obsidian=./nodestub.ts $ALIAS
mkdir -p shots
