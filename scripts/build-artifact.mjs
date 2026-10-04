// Genera dist/winter-arc-room.html: el juego en un solo archivo (JS y CSS en línea),
// listo para publicarlo como artifact de claude.ai o abrirlo desde cualquier hosting estático.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

execSync('npx vite build', { stdio: 'inherit' });
const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const js = html.match(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/);
const css = html.match(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/);
if (!js || !css) throw new Error('No encuentro el JS/CSS del build en dist/index.html');
const code = readFileSync(join(dist, js[1]), 'utf8').replace(/<\/script/gi, '<\\/script');
const style = readFileSync(join(dist, css[1]), 'utf8');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].trim();
const out = `<title>Winter Arc Room</title>
<style>${style}</style>
${body}
<script type="module">${code}</script>
`;
writeFileSync(join(dist, 'winter-arc-room.html'), out);
console.log(`dist/winter-arc-room.html · ${(out.length / 1024).toFixed(0)} KB`);
