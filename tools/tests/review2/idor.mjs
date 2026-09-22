import { boot, login } from '/home/user/HASC-LMS/tools/harness.mjs';
const { browser, page, errors } = await boot((process.argv[2]||'/home/user/HASC-LMS/work/out_fix.html'));
await login(page, 'staff');
const r = await page.evaluate(async () => { const L = window.__hascLogic; const me = String(L.state.currentUser.staffId);
  const other = (L.state.docs.completions || []).find(c => L.completionStaffId(c) !== me && L.completionComplianceCode(c) === 'CPR' && c.id && (c.certId || true));
  L.openCertFor(me, 'CPR', other.id, null); await new Promise(r => setTimeout(r, 300));
  const txt = (document.querySelector('#hasc-cert') || {}).innerText || '';
  return { me, other: { id: other.id, staff: L.completionStaffId(other), date: L.completionDate(other) }, modal: L.state.modal, certText: txt.slice(0, 400) }; });
console.log(JSON.stringify(r, null, 1)); await browser.close();
