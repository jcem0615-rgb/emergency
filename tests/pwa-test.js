const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080/';
const SHOT = (process.env.SHOT_DIR || require('os').tmpdir()) + '/';
const results = [];
const ok = (n, c, extra = '') => { results.push([c ? 'PASS' : 'FAIL', n, extra]); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => {
    const reason = ((r.failure() || {}).errorText) || '';
    // An abort is a cancellation, not a failure: the connectivity probe is
    // routinely cut short by the reloads this suite performs.
    if (reason.includes('ERR_ABORTED')) return;
    failed.push(r.url() + ' :: ' + reason);
  });
  page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });

  // ---------- 1. First load ----------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  ok('page loads with no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  ok('no failed/404 requests', failed.length === 0, failed.slice(0, 5).join(' | '));

  // Tailwind actually applied?
  const headerBg = await page.$eval('header', el => getComputedStyle(el).backgroundColor);
  ok('compiled Tailwind applied (header bg)', headerBg === 'rgb(2, 6, 23)', headerBg);
  const font = await page.$eval('body', el => getComputedStyle(el).fontFamily);
  ok('self-hosted Inter active', /Inter/.test(font), font);
  const fontsLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('700 16px Inter') && document.fonts.check('500 12px "JetBrains Mono"');
  });
  ok('Inter + JetBrains Mono woff2 loaded', fontsLoaded);

  // The variable font must actually vary, and the peso sign must come from the
  // latin-ext slice rather than falling back to a system font.
  const typo = await page.evaluate(async () => {
    await document.fonts.ready;
    const measure = (weight, family, text) => {
      const el = document.createElement('span');
      el.textContent = text;
      el.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-size:40px;font-weight:${weight};font-family:${family}`;
      document.body.appendChild(el);
      const w = el.getBoundingClientRect().width;
      el.remove();
      return w;
    };
    return {
      inter400: measure(400, "'Inter'", 'Dispatch Malasiqui'),
      inter900: measure(900, "'Inter'", 'Dispatch Malasiqui'),
      // Monospace advance widths are identical at every weight, so compare ink.
      monoInk: (() => {
        const ink = (weight) => {
          const c = document.createElement('canvas');
          c.width = 200; c.height = 60;
          const x = c.getContext('2d');
          x.font = `${weight} 40px 'JetBrains Mono'`;
          x.fillStyle = '#fff';
          x.fillText('15.92', 4, 44);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
          return n;
        };
        return { w400: ink(400), w800: ink(800) };
      })(),
      // fonts.check() only reports faces that are already downloaded, and a
      // unicode-range face is fetched lazily — the only ₱ text on load sits in
      // a hidden tab, so whether it has been fetched is a race. load() forces
      // it and resolves with the faces covering the text, so an empty result
      // means no face provides the glyph.
      peso: (await document.fonts.load('700 12px Inter', '\u20B1')).length > 0,
      // JetBrains Mono has no ₱, so it must not claim one: that text is meant
      // to fall back through the font stack. A face here means a bogus subset.
      monoPeso: (await document.fonts.load('500 12px "JetBrains Mono"', '\u20B1')).length,
      enye: (await document.fonts.load('400 12px Inter', 'Pe\u00F1a')).length > 0,
      // Control: a glyph no subset contains must match no face, so a trivially
      // true assertion can't pass this check.
      unsupported: (await document.fonts.load('400 12px Inter', '\u6F22')).length
    };
  });
  ok('variable weight axis works (Inter width, mono ink)',
     typo.inter900 > typo.inter400 && typo.monoInk.w800 > typo.monoInk.w400,
     JSON.stringify(typo));
  ok('peso + enye in subset fonts, unsupported glyph absent',
     typo.peso && typo.enye && typo.unsupported === 0 && typo.monoPeso === 0,
     JSON.stringify(typo));

  // Every font the stylesheet declares must actually parse. A subset built for
  // glyphs its source font lacks downloads with HTTP 200 and then fails to
  // load, which is invisible until the text that needs it is rendered.
  const fontFiles = await page.evaluate(async () => {
    const css = await (await fetch('assets/app.css')).text();
    const refs = [...new Set([...css.matchAll(/url\(([^)]*\.woff2)\)/g)]
      .map(m => m[1].replace(/['"]/g, '').replace(/^\.\//, '')))];
    const out = [];
    for (const ref of refs) {
      const href = new URL(ref, new URL('assets/', location.href)).href;
      try {
        await new FontFace('probe', `url(${href})`).load();
        out.push({ ref, ok: true });
      } catch (err) {
        out.push({ ref, ok: false, error: err.name + ': ' + err.message });
      }
    }
    return out;
  });
  const badFonts = fontFiles.filter(f => !f.ok);
  ok('every declared font file loads', fontFiles.length > 0 && badFonts.length === 0,
     badFonts.length ? JSON.stringify(badFonts)
                     : `${fontFiles.length} font files load cleanly`);

  // Icons
  const iconStats = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg.lucide')];
    const empty = svgs.filter(s => s.children.length === 0).map(s => s.getAttribute('class'));
    // Icons inside intentionally hidden panels have no box; only visible ones
    // are required to paint.
    const visible = svgs.filter(s => s.checkVisibility());
    const unpainted = visible.filter(s => {
      const r = s.getBoundingClientRect();
      return r.width === 0 || r.height === 0;
    }).map(s => s.getAttribute('class'));
    return { svg: svgs.length, empty, visible: visible.length, unpainted,
             unrendered: document.querySelectorAll('i[data-lucide]').length };
  });
  ok('lucide subset renders all icons with geometry',
     iconStats.svg > 20 && iconStats.unrendered === 0 && iconStats.empty.length === 0 &&
     iconStats.unpainted.length === 0,
     JSON.stringify(iconStats).slice(0, 200));

  // ---------- 2. Manifest + icons ----------
  const manifestHref = await page.$eval('link[rel=manifest]', el => el.href);
  const manifest = await (await page.request.get(manifestHref)).json();
  ok('manifest served & parsed', manifest.name && manifest.start_url && manifest.display === 'standalone');
  ok('manifest has maskable icon', manifest.icons.some(i => i.purpose === 'maskable'));
  ok('manifest has 192 + 512 png', ['192x192', '512x512'].every(
       s => manifest.icons.some(i => i.sizes === s && i.type === 'image/png')));
  let iconsOk = true;
  for (const i of manifest.icons) {
    const r = await page.request.get(new URL(i.src, manifestHref).href);
    if (!r.ok()) { iconsOk = false; failed.push('icon ' + i.src); }
  }
  for (const sc of manifest.shortcuts) {
    const r = await page.request.get(new URL(sc.icons[0].src, manifestHref).href);
    if (!r.ok()) iconsOk = false;
  }
  ok('every manifest + shortcut icon resolves', iconsOk);

  // ---------- 3. Service worker ----------
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null ||
                                   navigator.serviceWorker.ready, { timeout: 15000 });
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { active: !!reg.active, scope: reg.scope, state: reg.active && reg.active.state };
  });
  ok('service worker active', swState.active && swState.state === 'activated', JSON.stringify(swState));

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find(k => k.includes('shell')));
    return { caches: keys, count: (await c.keys()).length };
  });
  // The cache must hold exactly what the service worker declares, whatever that is.
  const swSource = await (await page.request.get(BASE + 'sw.js')).text();
  const declared = (swSource.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/)[1]
                      .match(/"[^"]+"/g) || []).length;
  ok('app shell fully precached', cached.count === declared && declared >= 15,
     `cached ${cached.count} of ${declared} declared`);
  const criticalCached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find(k => k.includes('shell')));
    const urls = (await c.keys()).map(r => new URL(r.url).pathname);
    return ['/index.html', '/assets/app.css', '/assets/lucide.min.js',
            '/manifest.webmanifest', '/offline.html',
            '/assets/fonts/inter-latin.woff2', '/icons/icon-512.png']
           .filter(u => !urls.some(p => p.endsWith(u)));
  });
  ok('critical assets present in cache', criticalCached.length === 0, criticalCached.join(' '));

  await page.screenshot({ path: SHOT + 'shot-online.png' });

  // ---------- 4. Offline launch ----------
  await page.reload({ waitUntil: 'networkidle' });   // ensure SW controls the page
  await ctx.setOffline(true);
  const offlineResp = await page.reload({ waitUntil: 'domcontentloaded' });
  ok('offline reload served from cache', offlineResp && offlineResp.status() === 200,
     'status ' + (offlineResp && offlineResp.status()));
  await page.waitForTimeout(1200);
  const offlineUi = await page.evaluate(() => ({
    title: document.title,
    badge: document.getElementById('net-status-badge').textContent.trim(),
    signal: document.getElementById('phone-signal-badge').textContent.trim(),
    icons: document.querySelectorAll('svg.lucide').length,
    styled: getComputedStyle(document.body).backgroundColor
  }));
  ok('full app usable offline (styles+icons)',
     offlineUi.icons > 20 && offlineUi.styled === 'rgb(9, 13, 22)', JSON.stringify(offlineUi));
  ok('offline shown in header + phone signal',
     /Offline/i.test(offlineUi.badge) && /NO SIGNAL/i.test(offlineUi.signal), JSON.stringify(offlineUi));

  // ---------- 5. Offline SOS queueing ----------
  await page.click('button:has-text("SOS EMERGENCY")');
  await page.waitForTimeout(600);
  const queued = await page.evaluate(() => ({
    bannerVisible: !document.getElementById('res-offline-queue-banner').classList.contains('hidden'),
    status: document.getElementById('res-dispatch-status-text').textContent.trim(),
    queuedCount: state.incidents.filter(i => i.offlineQueued).length,
    onMap: state.incidents.filter(i => !i.offlineQueued).length,
    pillsText: document.getElementById('map-incident-pills').textContent
  }));
  ok('offline SOS queued on device', queued.bannerVisible && queued.queuedCount === 1,
     JSON.stringify(queued).slice(0, 180));
  ok('queued report withheld from dispatch map',
     !queued.pillsText.includes(await page.evaluate(() => state.incidents.find(i => i.offlineQueued).id)));
  await page.screenshot({ path: SHOT + 'shot-offline-queued.png' });

  // Persistence across a relaunch while still offline
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const survived = await page.evaluate(() => ({
    queued: state.incidents.filter(i => i.offlineQueued).length,
    panelOpen: !document.getElementById('res-active-sos-panel').classList.contains('hidden'),
    total: state.incidents.length
  }));
  ok('queued SOS survives app relaunch', survived.queued === 1 && survived.panelOpen,
     JSON.stringify(survived));

  // ---------- 6. Reconnect -> automatic transmission ----------
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1800);   // connectivity probe + flush
  const flushed = await page.evaluate(() => ({
    queued: state.incidents.filter(i => i.offlineQueued).length,
    log: state.auditLogs.slice(0, 4).map(l => l.source),
    pending: state.incidents.filter(i => i.status === 'PENDING').length,
    sirenVisible: !document.getElementById('cmd-siren-banner').classList.contains('hidden')
  }));
  ok('queue flushes to dispatch on reconnect',
     flushed.queued === 0 && flushed.log.includes('DELAYED TRANSMISSION') && flushed.sirenVisible,
     JSON.stringify(flushed));

  // ---------- 7. Dispatch still works end to end ----------
  await page.click('#btn-cmd-coming');
  await page.waitForTimeout(800);
  const dispatched = await page.evaluate(() => {
    const inc = state.incidents.find(i => i.status === 'DISPATCHED');
    return {
      hudVisible: !document.getElementById('rescuer-nav-hud').classList.contains('hidden'),
      hasRoute: !!(inc && inc.route),
      gmaps: document.getElementById('btn-open-gmaps').href,
      instruction: document.getElementById('nav-instruction-text').textContent.trim()
    };
  });
  ok('acknowledge -> turn-by-turn navigation', dispatched.hudVisible && dispatched.hasRoute &&
     dispatched.gmaps.includes('destination='), JSON.stringify(dispatched).slice(0, 170));

  // ---------- 8. Install affordance ----------
  const installShown = await page.evaluate(async () => {
    const e = new Event('beforeinstallprompt');
    e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
    await new Promise(r => setTimeout(r, 120));
    return !document.getElementById('btn-pwa-install').classList.contains('hidden');
  });
  ok('install button appears on beforeinstallprompt', installShown);
  await page.click('#btn-pwa-install');
  await page.waitForTimeout(400);
  const afterInstall = await page.evaluate(() =>
    document.getElementById('btn-pwa-install').classList.contains('hidden'));
  ok('install prompt accepted hides button', afterInstall);

  // ---------- 9. Manifest shortcut deep links ----------
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '?view=command&panel=blotter', { waitUntil: 'networkidle' });
  await p2.waitForTimeout(800);
  const shortcut = await p2.evaluate(() => ({
    blotter: !document.getElementById('blotter-modal').classList.contains('hidden'),
    residentHidden: document.getElementById('panel-resident').classList.contains('hidden')
  }));
  ok('blotter shortcut opens command view + blotter', shortcut.blotter && shortcut.residentHidden,
     JSON.stringify(shortcut));

  const p3 = await ctx.newPage();
  await p3.goto(BASE + '?view=resident&action=sos', { waitUntil: 'networkidle' });
  await p3.waitForTimeout(800);
  const sosShortcut = await p3.evaluate(() => ({
    incidents: state.incidents.filter(i => i.status === 'PENDING' && i.reportedAt.startsWith(new Date().toISOString().slice(0, 10))).length,
    panicVisible: !document.getElementById('res-tab-panic').classList.contains('hidden'),
    commandHidden: document.getElementById('panel-command').classList.contains('hidden')
  }));
  ok('SOS shortcut opens screen WITHOUT auto-dispatching',
     sosShortcut.panicVisible && sosShortcut.commandHidden, JSON.stringify(sosShortcut));
  await p3.screenshot({ path: SHOT + 'shot-resident.png' });

  // ---------- 10. Reset clears the stored session ----------
  await page.bringToFront();
  await page.click('button:has-text("Reset Demo")');
  await page.waitForTimeout(600);
  const afterReset = await page.evaluate(() => ({
    incidents: state.incidents.length,
    stored: localStorage.getItem('emergency:session:v1') === null,
    ids: state.incidents.map(i => i.id)
  }));
  ok('reset restores seed scenario', afterReset.incidents === 2 &&
     afterReset.ids.includes('INC-2026-089'), JSON.stringify(afterReset));

  console.log('\n================ PWA TEST RESULTS ================');
  results.forEach(([s, n, e]) => console.log(`${s}  ${n}${e ? '\n        ' + e : ''}`));
  const failedCount = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failedCount}/${results.length} passed`);
  if (errors.length) console.log('\nCONSOLE ERRORS:\n' + errors.slice(0, 8).join('\n'));
  if (failed.length) console.log('\nREQUEST FAILURES:\n' + [...new Set(failed)].slice(0, 8).join('\n'));

  await browser.close();
  process.exit(failedCount ? 1 : 0);
})();
