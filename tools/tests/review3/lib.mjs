import { chromium } from 'playwright';
import path from 'node:path';
export const FIX = '/home/user/HASC-LMS/work/out_review3.html';
export const ORIG = '/home/user/HASC-LMS/work/out.html';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function ctxOpen(file = FIX, { persistentDir } = {}) {
  let browser = null, ctx;
  if (persistentDir) ctx = await chromium.launchPersistentContext(persistentDir, { viewport: { width: 1200, height: 800 } });
  else { browser = await chromium.launch(); ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } }); }
  await ctx.route(/^https?:\/\//, r => r.abort());
  const errors = [];
  const open = async (name, f = file, init) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') errors.push(name + ' ' + m.type() + ': ' + m.text().slice(0, 200)); });
    p.on('dialog', d => d.accept());
    if (init) await p.addInitScript(init);
    await p.goto('file://' + path.resolve(f));
    await p.waitForFunction(() => window.__hascLogic && window.__hascLogic._dataReady, null, { timeout: 120000 });
    await p.evaluate(() => { const L = window.__hascLogic; L.signIn('admin', L.ACCOUNTS.admin[0]); window.confirm = () => true; window.prompt = () => ''; window.alert = () => {}; });
    await p.waitForTimeout(1500);
    return p;
  };
  const close = async () => { if (browser) await browser.close(); else await ctx.close(); };
  return { ctx, open, errors, close };
}
export const ev = (p, fn, arg) => p.evaluate(fn, arg).catch(e => ({ __err: String(e && e.message || e).slice(0, 400) }));
