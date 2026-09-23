// E10: an async flow (staff import) computed docs from a snapshot; while it awaits storage, the tab adopts TWO
// separate saves from another tab. Does the import's docs write delete the other tab's first completion?
import { ctxOpen, ev, sleep } from './lib.mjs';
const file = process.argv[2]; const DELAY = Number(process.argv[3] || 3000); const ADOPTS = Number(process.argv[4] || 2);
const { open, close } = await ctxOpen(file);
const A = await open('A'), B = await open('B');
const st = await ev(A, () => { const a = window.__hascLogic._activeRosterMemo(); return { loc: a[0].loc, s: a.slice(300, 305).map(x => String(x.id)) }; });
// Slow storage for A's undo-point write (simulates a slow disk / large payload): widens the window.
await ev(A, (DELAY) => { const L = window.__hascLogic; const o = L._opsPut.bind(L); L._opsPut = async (k, v) => { if (DELAY && k === "lastStaffImportUndo" && v) await new Promise(r => setTimeout(r, DELAY)); return o(k, v); }; }, DELAY);
const pImport = ev(A, async (loc) => { const L = window.__hascLogic; const csv = 'Employee Number,Last Name,First Name,Status,Location\n88880001,Race,Person,A,"' + loc + '"';
  await L.importEmpeon({ target: { files: [{ name: 'e10.csv', text: async () => csv }] } }); await L.applyImport(); return !!L.staffById('88880001'); }, st.loc);
await sleep(Number(process.argv[5]||0));
const ids = [];
for (let k = 0; k < ADOPTS; k++) {
  const id = await ev(B, ({ sid, k }) => { const L = window.__hascLogic, d = L.state.docs; const id = 'e10-B-' + k + '-' + Date.now(); L.saveDocs({ ...d, completions: [...d.completions, { id, staffId: sid, code: 'CPR', complianceCode: 'CPR', date: '9/8/2026', source: 'Manual Admin Entry' }] }); return id; }, { sid: st.s[k], k });
  ids.push(id); await sleep(Number(process.argv[6]||150));
}
const imported = await pImport; await sleep(3000);
const q = p => ev(p, (ids) => { const L = window.__hascLogic; const c = L.state.docs.completions; return { comps: ids.map(id => c.some(x => x.id === id)), staff: !!L.staffById('88880001') }; }, ids);
console.log('imported', imported, 'A', await q(A), 'B', await q(B));
const C = await open('C'); console.log('fresh C', await q(C));
await close();
