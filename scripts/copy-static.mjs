import { cpSync, mkdirSync, rmSync } from 'node:fs';

const FILES = ['index.html', 'view.html'];

mkdirSync('dist', { recursive: true });
for (const f of FILES) cpSync(f, `dist/${f}`);

console.log(`Staged ${FILES.join(', ')} -> dist/`);
