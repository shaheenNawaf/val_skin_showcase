import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FILES = ['index.html', 'view.html', 'browse.html', 'terms.html', 'privacy.html'];
const DIRS = ['css', 'js'];

// ── build metadata: Netlify env vars first, git fallback for local builds ──
function git(args) {
  try { return execSync(`git ${args}`, { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version || '0.0.0';
const sha = (process.env.COMMIT_REF || git('rev-parse --short HEAD') || 'unknown').slice(0, 7);
const branch = process.env.BRANCH || process.env.HEAD || git('rev-parse --abbrev-ref HEAD') || 'local';
const date = new Date().toISOString().slice(0, 10);

// Netlify CONTEXT: production | deploy-preview | branch-deploy ; anything else = local build
const ctx = process.env.CONTEXT;
const env = ctx === 'production' ? 'production'
  : ctx === 'deploy-preview' ? 'preview'
  : ctx === 'branch-deploy' ? 'staging'
  : 'local';
const envLabel = { production: 'PRODUCTION', preview: 'PREVIEW', staging: 'STAGING', local: 'LOCAL' }[env];

const stamp =
  `<div id="buildstamp" data-env="${env}" title="Built from ${branch} @ ${sha} on ${date} (UTC)">` +
  `<span class="bs-env">${envLabel}</span>` +
  `<span class="bs-ver">v${version} \u00b7 ${sha} \u00b7 ${date} \u00b7 ${branch}</span>` +
  `</div>`;

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
for (const d of DIRS) cpSync(d, `dist/${d}`, { recursive: true });
for (const f of FILES) {
  const html = readFileSync(f, 'utf8').replace('</body>', `${stamp}\n</body>`);
  writeFileSync(`dist/${f}`, html);
}

console.log(`Staged ${FILES.concat(DIRS).join(', ')} -> dist/  [${env} v${version} ${sha}]`);