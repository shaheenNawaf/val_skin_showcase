/* Build-time guard for the immutable cache policy in _headers.
   css/, js/ and fonts/ ship with `Cache-Control: public, max-age=31536000,
   immutable`, so an unversioned URL would be cached for a year with no way to
   invalidate it, and a stale version would serve the wrong file for a year.
   Two assertions, both over the source tree, never over dist/:
     1. every local asset reference carries a ?v= query;
     2. every ?v= value equals the "version" field in package.json.
   Exempt by design: external http(s) and data: URLs, HTML-to-HTML links such as
   terms.html, CSS url() references (fonts/*.woff2 are reached only through
   css/fonts.css, which is itself versioned), and js/vendor as a source of
   specifiers. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HTML_FILES = ['index.html', 'build.html', 'view.html', 'dashboard.html', 'sold.html', 'terms.html', 'privacy.html', '404.html'];
const LOCAL_PREFIXES = ['css/', 'js/', 'fonts/', './', '../'];
const HTML_RE = /(?:href|src)="([^"]+)"/g;
const JS_RE = [/(?:from|import)\s*\(?\s*'([^']+)'/g, /\.src\s*=\s*'([^']+)'/g];
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;

const unversioned = [];
const mismatched = [];

function scan(file, patterns) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    const t = line.trim();
    /* Comment lines are skipped so a specifier mentioned in prose cannot fail
       the build. Only whole-line comments are recognised. */
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return;
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const v = m[1];
        if (!LOCAL_PREFIXES.some(p => v.startsWith(p))) continue;
        const at = v.indexOf('?v=');
        if (at === -1) {
          unversioned.push(file + ':' + (idx + 1) + ' ' + v);
          continue;
        }
        const ver = v.slice(at + 3).split(/[&#]/)[0];
        if (ver !== VERSION) {
          mismatched.push(file + ':' + (idx + 1) + ' ' + v + '  (package.json says ' + VERSION + ')');
        }
      }
    }
  });
}

HTML_FILES.forEach(f => scan(f, [HTML_RE]));
readdirSync('js').filter(f => f.endsWith('.js')).forEach(f => scan(join('js', f), JS_RE));

if (unversioned.length || mismatched.length) {
  if (unversioned.length) {
    console.error('check:versions — asset references with no ?v= query:');
    unversioned.forEach(b => console.error('  ' + b));
  }
  if (mismatched.length) {
    console.error('check:versions — ?v= does not match package.json version ' + VERSION + ':');
    mismatched.forEach(b => console.error('  ' + b));
  }
  process.exit(1);
}
console.log('check:versions — every asset reference carries ?v=' + VERSION);