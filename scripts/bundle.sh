#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Building dashboard..."
npx parcel build index.html --no-source-maps --dist-dir dist

echo "Creating single HTML file..."
node -e "
const fs = require('fs');
const html = fs.readFileSync('dist/index.html', 'utf8');
const css = html.match(/<link rel=\"stylesheet\" href=\"([^\"]+)\">/);
const js = html.match(/<script type=\"module\" src=\"([^\"]+)\">/);
let out = html;
if (css) { const c = fs.readFileSync('dist/' + css[1], 'utf8'); out = out.replace(css[0], '<style>' + c + '</style>'); }
if (js) { const j = fs.readFileSync('dist/' + js[1], 'utf8'); out = out.replace(js[0], '<script>' + j + '</script>'); }
out = out.replace('</head>', '<script src=\"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js\"></script></head>');
fs.writeFileSync('ocean-ereferral-dashboard.html', out);
console.log('Done: ' + Math.round(out.length/1024) + 'KB');
"
