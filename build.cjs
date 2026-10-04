/* Single-file distribution; run with Node.js, no packages required. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--pages')) {
  throw new Error('Usage: node build.cjs [--pages]');
}
const pagesBuild = args[0] === '--pages';
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const scripts = ['irs-limits.js', 'annual-calculations.js', 'policy-parser.js', 'app.js'];
const replacements = [
  ['<link rel="stylesheet" href="styles.css">', '<style>\n' + read('styles.css').replace(/<\/style/gi, '<\\/style') + '\n</style>'],
  ...scripts.map(name => ['<script src="' + name + '" defer></script>', '']),
  ['</body>', scripts.map(name => '<script>\n' + read(name).replace(/<\/script/gi, '<\\/script') + '\n</script>').join('\n') + '\n</body>']
];
let html = read('index.html');
for (const [from, to] of replacements) {
  if (!html.includes(from)) throw new Error('Missing build marker: ' + from);
  html = html.replace(from, () => to);
}
// CI publishes only this directory, never the source tree or parent directory.
const output = pagesBuild
  ? path.join(__dirname, 'dist', 'index.html')
  : path.resolve(__dirname, '..', '401k-calculator.html');
if (pagesBuild) {
  fs.rmSync(path.join(__dirname, 'dist'), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
}
fs.writeFileSync(output, html);
console.log('Built ' + output);
