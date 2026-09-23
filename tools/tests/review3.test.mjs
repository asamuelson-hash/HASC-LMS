// Cross-tab persistence findings from review3 / re-review, asserted with the reviewer's scripts.
//   node tests/review3.test.mjs [build]
import { execFileSync } from 'node:child_process';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'review3');
const run = (f, ...a) => { try { return execFileSync('node', [path.join(dir, f), FILE, ...a], { cwd: path.join(dir, '..', '..'), encoding: 'utf8', timeout: 600000 }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const results = []; const check = (id, name, ok, detail) => results.push({ id, name, ok: !!ok, detail });
// RR-01: rows created in tab B can be deleted in tab A (template, archive, session, location)
for (let i = 0; i < 2; i++) { const o = run('e16.mjs'); const m = o.match(/fresh C (\{.*\})/); const c = m && JSON.parse(m[1]);
  check('RR-01.' + i, 'deletes of rows another tab created persist (fresh tab)', c && c.tmplGone && c.unarchived && c.sessGone && c.locGone, c || o.slice(-300)); }
// R3-01: a staff import in A never deletes completions B saved during it
for (const [d, a] of [['1500', '2'], ['3000', '3']]) { const o = run('e10b.mjs', d, a); const m = o.match(/fresh C (\{.*\})/s);
  const ok = /imported true/.test(o) && m && !/false/.test(m[1]); check('R3-01.' + d + '/' + a, 'completions saved in B during A’s import survive', ok, o.slice(-300)); }
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(12) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail).slice(0, 400))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
