import { cpSync, mkdirSync, rmSync } from 'node:fs';

const FILES = ['index.html', 'view.html'];
const DIRS = ['css', 'js'];

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
for (const f of FILES) cpSync(f, `dist/${f}`);
for (const d of DIRS) cpSync(d, `dist/${d}`, { recursive: true });

console.log(`Staged ${FILES.concat(DIRS).join(', ')} -> dist/`);
