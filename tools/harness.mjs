// Headless harness for the HASC LMS bundle.
//   import { boot, login, shot } from './harness.mjs'
//   const { browser, page, errors } = await boot('work/out.html');
//   await login(page, 'admin');            // or 'manager' | 'instructor' | 'staff'
//   const v = await page.evaluate(() => window.__hascLogic.state.roster.length);
// Each boot() gets a fresh browser profile (clean localStorage/IndexedDB).
import { chromium } from 'playwright';
import path from 'node:path';

export async function boot(file = 'work/out.html', { viewport = { width: 1400, height: 900 } } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await browser.newContext({ viewport });
  await ctx.route(/^https?:\/\//, r => r.abort()); // offline: no CDN/video
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('file://' + path.resolve(file));
  await page.waitForFunction(() => window.__hascLogic && window.__hascLogic._dataReady, null, { timeout: 120000 });
  return { browser, ctx, page, errors };
}

// Programmatic sign-in using the same signIn() the login form calls.
export async function login(page, role, acct) {
  await page.evaluate(([role, acct]) => {
    const L = window.__hascLogic;
    const D = window.HASC_DATA || {};
    let a = acct;
    if (!a) {
      if (role === 'admin') a = L.ACCOUNTS.admin[0];
      else if (role === 'instructor') a = L.ACCOUNTS.instructor[0];
      else if (role === 'manager') { const m = (D.managers || [])[0]; a = { email: m.email, name: m.name, roleLabel: 'Manager', empId: m.empId, assignedLocations: m.locations || [] }; }
      else if (role === 'staff') a = L.ACCOUNTS.staff[0];
    }
    L.signIn(role, a);
  }, [role, acct || null]);
  await page.waitForTimeout(300);
}

export async function tab(page, role, key) {
  await page.evaluate(([role, key]) => { const L = window.__hascLogic; L.setState({ tab: { ...L.state.tab, [role]: key } }); }, [role, key]);
  await page.waitForTimeout(250);
}

export async function shot(page, name) { await page.screenshot({ path: `work/shots/${name}.png`, fullPage: false }); }
