// UX-11 phone layout at 390x844.  node tests/phone.test.mjs [build]
import { boot, login, tab } from '../harness.mjs';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const results = []; const check = (id, name, ok, detail) => results.push({ id, name, ok: !!ok, detail });
const { browser, page, errors } = await boot(FILE, { viewport: { width: 390, height: 844 } });
const inView = (labels) => page.evaluate((labels) => labels.map(l => { const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && x.innerText.trim() === l); if (!b) return l + ':missing'; const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= 390 ? 'ok' : l + ':' + Math.round(r.left) + '-' + Math.round(r.right); }), labels);
await login(page, 'staff'); await tab(page, 'staff', 'trainings');
{ const r = await inView(['My Trainings', 'My Upcoming Sessions', 'My Transcript', 'My Certificates']); check('UX-11a', 'all staff tabs visible without sideways scrolling', r.every(x => x === 'ok'), r); }
{ const h = await page.evaluate(() => { const hd = document.querySelector('.hasc-header-inner'); return hd ? Math.round(hd.getBoundingClientRect().height) : null; }); check('UX-11b', 'header is compact (< 140px)', h && h < 140, h); }
await page.evaluate(() => window.__hascLogic.setState({ currentUser: null, role: null, authStep: 'select' })); await page.waitForTimeout(200);
await login(page, 'instructor'); await tab(page, 'instructor', 'attendance');
await page.evaluate(() => { const L = window.__hascLogic; const s = L.state.sessions.find(x => (x.roster || []).length); L.setState({ instSession: s && s.id }); }); await page.waitForTimeout(300);
{ const r = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && /^(Pass|Fail)$/.test(b.innerText.trim())).slice(0, 4).map(b => Math.round(b.getBoundingClientRect().right)));
  check('UX-11c', 'instructor Pass/Fail buttons are on screen', r.length >= 2 && r.every(x => x <= 390), r); }
{ const sw = await page.evaluate(() => document.documentElement.scrollWidth); check('UX-11d', 'no page-level horizontal overflow', sw <= 390, sw); }
const errs = errors.filter(e => !/permissions policy|ERR_FAILED|net::ERR/.test(e)); check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
