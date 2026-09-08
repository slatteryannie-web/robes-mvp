// Homescreen FTUE harness — boots the real dashboard with Supabase + REST
// stubbed, at each wardrobe piece count, and asserts the milestone/gating
// rules. Run manually: npm i --no-save playwright && node scripts/ftue_harness.mjs
// Set CHROME_PATH when playwright's bundled browser build isn't installed.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res) => {
  const on = (b) => { if (String(b).includes('listening') || String(b).includes(String(PORT))) res(); };
  server.stdout.on('data', on); server.stderr.on('data', on);
  setTimeout(res, 2500);
});

const SUPA_STUB = `
window.supabase = {
  createClient(){
    const sess = { user: { id: 'u-test', email: 't@t.co' }, access_token: 'tok' };
    const q = () => ({
      select(){ return this; }, eq(){ return this; }, order(){ return this; },
      single(){ return Promise.resolve({ data: window.__TEST_PROFILE, error: null }); },
      then(r){ return Promise.resolve({ data: [], error: null }).then(r); },
    });
    return {
      auth: {
        onAuthStateChange(){ return { data: { subscription: { unsubscribe(){} } } }; },
        getSession(){ return Promise.resolve({ data: { session: sess } }); },
        signOut(){ return Promise.resolve({}); },
      },
      from(){ return q(); },
    };
  }
};`;

function wardrobe(n) {
  const cats = ['Tops', 'Bottoms', 'Shoes', 'Outerwear'];
  return Array.from({ length: n }, (_, i) => ({
    id: 'w' + i, user_id: 'u-test', label: 'Piece ' + (i + 1),
    category: cats[i % 4], color: 'Black', brand: '', notes: '',
    image_url: null, times_worn: 0, item_dna: {}, hero_position: null,
    created_at: new Date().toISOString(),
  }));
}

// The learning card and the home Lookbook row only render once home has
// left its FTU states — zero looks shows the quiet index rows (W01/O1),
// exactly ONE look shows the O7 "Your looks" page (FTU simplification
// 2026-08-18). Seed TWO saved looks by default so the milestone rules below
// still have a card to assert against; pass looks:false for the zero state.
async function boot(browser, n, width = 1280, { looks = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1100 } });
  const page = await ctx.newPage();

  await page.route('**cdn.jsdelivr.net/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA_STUB }));
  await page.route('**ayowpaknssulsqqvwpqx.supabase.co/**', (r) => {
    const u = r.request().url();
    const body = u.includes('wardrobe_items') ? JSON.stringify(wardrobe(n)) : '[]';
    return r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.route('**nominatim**', (r) => r.abort());
  await page.route('**open-meteo**', (r) => r.abort());

  await page.addInitScript((count) => {
    window.__TEST_PROFILE = {
      first_name: 'Annie', last_name: '', mobile: '', style_icons: [], budget: null,
      wardrobe_description: '', style_dna: {}, wardrobe_items_count: count,
      onboarded_at: '2026-07-01', gender_identity: 'woman',
    };
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
  }, n);
  if (looks) {
    // TWO saved looks, not one: a single look is the O7 first-look state
    // (hero card, tracker hidden), and a daily look would not fill the
    // Lookbook at all (Look Rules 1a, 2026-08-17).
    await page.addInitScript(() => {
      localStorage.setItem('rb_looks__u-test', JSON.stringify([
        { id: 'lk-seed', name: 'A look', name_provisional: false, note: '', photo_url: null,
          tags: null, climate_band: 'year_round', climate_source: 'derived', source: 'manual',
          origin_look_id: null, created_at: '2026-08-05T10:00:00.000Z',
          pieces: [{ id: 'w0', slot: 'Top', position: 0, role: null }, { id: 'w1', slot: 'Bottom', position: 1, role: null }],
          wears: [] },
        { id: 'lk-seed-2', name: 'A second look', name_provisional: false, note: '', photo_url: null,
          tags: null, climate_band: 'year_round', climate_source: 'derived', source: 'manual',
          origin_look_id: null, created_at: '2026-08-04T10:00:00.000Z',
          pieces: [{ id: 'w2', slot: 'Top', position: 0, role: null }, { id: 'w3', slot: 'Bottom', position: 1, role: null }],
          wears: [] },
      ]));
    });
  }

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  return { ctx, page, errs };
}

const _RB_ROLE_NAMES = ['The Canvas', 'The Anchor', 'The Texture', 'The Exclamation Point'];
const results = [];
const check = (name, pass, detail = '') =>
  results.push({ name, pass, detail }) && void 0;

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

for (const n of [0, 1, 3, 5, 10, 15, 16]) {
  const { ctx, page, errs } = await boot(browser, n);

  check(`n=${n} · no page errors`, errs.length === 0, errs.join(' | ').slice(0, 200));

  const state = await page.evaluate(() => {
    const dash = document.getElementById('dash');
    const vis = (el) => !!el && el.offsetParent !== null;
    const order = Array.from(dash ? dash.children : [])
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.id || el.className.split(' ')[0]);
    return {
      order,
      trackerVisible: vis(document.getElementById('wtrk')),
      servicesVisible: vis(document.querySelector('.services')),
      styleNotes: !!document.getElementById('rb-sil-prompt'),
      // The merged header meter (2a): eyebrow + count + line + one caption
      learnEy: document.querySelector('#rb-svc-learn .ey')?.textContent || '',
      learnN: document.querySelector('#rb-svc-learn .n')?.textContent || '',
      learnCap: document.querySelector('#rb-svc-learn .cap')?.textContent || '',
      learnFill: document.querySelector('#rb-svc-learn .bar i')?.style.width || '',
      secMeta: !!document.querySelector('.services .sec-meta'),
      bandTint: (() => {
        const el = document.querySelector('.services');
        return el ? getComputedStyle(el).backgroundColor : '';
      })(),
      dailyImg: document.querySelector('.svc-daily .svc-img img')?.getAttribute('src') || '',
      filledInBand: Array.from(document.querySelectorAll('.services button, .services .svc-cta, #rb-svc-filed .cta'))
        .filter((el) => el.offsetParent !== null)
        .filter((el) => getComputedStyle(el).backgroundColor === 'rgb(32, 32, 33)').length,
      pill: document.querySelector('.services .rb-lock-pill')?.textContent || '',
      // Card captions — the specific version of "filing buys quality"
      notes: Array.from(document.querySelectorAll('.services-grid .svc')).map((c) => ({
        title: c.querySelector('.svc-title')?.textContent,
        note: c.querySelector('.rb-svc-note')?.textContent || '',
      })),
      // The filed-piece row — a receipt, not a wardrobe
      filed: (() => {
        const r = document.getElementById('rb-svc-filed');
        if (!r) return null;
        return {
          thumbs: r.querySelectorAll('.th').length,
          nm: r.querySelector('.nm')?.textContent || '',
          meta: r.querySelector('.meta')?.textContent || '',
          all: r.querySelector('.all')?.textContent || '',
          note: r.querySelector('.note')?.textContent || '',
          cta: r.querySelector('.cta')?.textContent || '',
        };
      })(),
      railAfterConcierge: (() => {
        const c = dash?.querySelector('.concierge');
        return !!c && c.nextElementSibling?.id === 'rb-rail';
      })(),
    };
  });

  // MERGED (2a, 2026-08-18): the standalone learning card never renders —
  // Robes is learning lives inside the Styling Concierge header.
  check(`n=${n} · standalone learning card never renders`,
    state.trackerVisible === false);

  // Load rules (2026-08-19): the concierge stands from the FIRST session,
  // at any piece count — only "Your piece, styled" holding the screen
  // delays it, and none of these boots carries the styled card.
  check(`n=${n} · concierge shown at every count (no piece floor)`,
    state.servicesVisible === true);
  if (n === 0) {
    check('n=0 · the band paints with an empty receipt (CTA only, no thumb)',
      !!state.filed && state.filed.thumbs === 0 && state.filed.nm === ''
        && /Catalogue what you’re wearing now/.test(state.filed.cta),
      JSON.stringify(state.filed));
  }

  // Style Notes only at the last milestone
  check(`n=${n} · style notes ${n >= 15 ? 'introduced' : 'absent'}`,
    state.styleNotes === (n >= 15), `got ${state.styleNotes}`);

  // Rail stays glued to the prompt, which leads the page at every count;
  // the concierge follows the rail, ahead of the Lookbook row (its slot is
  // a rule now, not an accident of markup order).
  check(`n=${n} · rail follows prompt`, state.railAfterConcierge, JSON.stringify(state.order));
  {
    const iCon = state.order.findIndex((x) => x === 'concierge');
    const iSvc = state.order.indexOf('services');
    const iSn = state.order.indexOf('rb-sn');
    check(`n=${n} · prompt leads, concierge after the rail, before the Lookbook row`,
      iCon >= 0 && iSvc > iCon && (iSn === -1 || iSvc < iSn), JSON.stringify(state.order));
  }

  // The merged header meter: bare count, no denominator, the one honest
  // reason to catalogue, and the fill still walks the milestone curve.
  if (n >= 3) {
    check(`n=${n} · header meter reads "Robes is learning · N pieces filed"`,
      state.learnEy === 'Robes is learning'
        && new RegExp(`^${n}\\s*pieces? filed$`, 'i').test(state.learnN.trim())
        && state.secMeta === false,
      JSON.stringify([state.learnEy, state.learnN, state.secMeta]));
    // 4a: no caption line under the meter — the eyebrow, rail and count
    // carry the header; the card captions carry the borrowed-piece claim.
    check(`n=${n} · no title or caption line on the band header`,
      state.learnCap === '', state.learnCap);
    // R6: fill = min(pieces / 15, 1) — linear, the milestone curve retired.
    const want = Math.min(100, (n / 15) * 100);
    check(`n=${n} · meter fill ${want.toFixed(1)}% (linear)`,
      Math.abs(parseFloat(state.learnFill) - want) < 0.6, `got ${state.learnFill}`);
    // The tinted band (4a): #F2EEE7, exactly one per screen, and no filled
    // dark button inside it (R3 — the prompt keeps the only one).
    check(`n=${n} · the concierge is the tinted band, no filled button inside`,
      state.bandTint === 'rgb(242, 238, 231)' && state.filledInBand === 0,
      JSON.stringify([state.bandTint, state.filledInBand]));
    check(`n=${n} · the cards carry the look photography`,
      /looks\/look1\.jpg/.test(state.dailyImg), state.dailyImg);
    check(`n=${n} · no denominator, no lock language anywhere on the module`,
      !/\/\s*\d|of 15|unlock|lock/i.test(state.learnN + ' ' + state.learnCap
        + ' ' + state.notes.map((x) => x.note).join(' ')),
      state.learnN);

    // NOTHING GATED: the progress pill is gone; each card carries its
    // one-line caption instead.
    check(`n=${n} · no progress pill on any card`, state.pill === '', state.pill);
    const noteFor = (t) => (state.notes.find((x) => x.title === t) || {}).note;
    const wantDaily = n >= 15
      ? 'Today’s look: styled entirely from your closet.'
      : n >= 4
        ? 'Today’s look: your pieces first, gaps borrowed.'
        : `Today’s look: ${n} piece${n === 1 ? '' : 's'} yours, ${4 - n} borrowed.`;
    check(`n=${n} · card captions say what filing buys`,
      noteFor('Daily outfit') === wantDaily
        && noteFor('Weekly planner') === 'Each day styled from your own wardrobe.'
        && noteFor('Travel edit') === 'Tell Robes where and how long.',
      JSON.stringify(state.notes));

    // The filed-piece row: one thumbnail always, the caption flipping from
    // "your first filed piece" to "last filed" + a way into the wardrobe.
    check(`n=${n} · filed row is a one-thumb receipt with the add door`,
      !!state.filed && state.filed.thumbs === 1
        && state.filed.nm === 'Piece 1'
        && state.filed.note === 'One photo files four pieces.'
        && /Catalogue what you’re wearing now/.test(state.filed.cta),
      JSON.stringify(state.filed));
    check(`n=${n} · filed row caption ${n === 1 ? 'names the first' : 'reads last filed + count'}`,
      n === 1
        ? (/Your first filed piece/i.test(state.filed.meta) && state.filed.all === '')
        : (/Last filed/i.test(state.filed.meta)
          && state.filed.all.indexOf(n + ' pieces in your wardrobe') === 0
          && /See all/.test(state.filed.all)),
      JSON.stringify(state.filed));
  }

  await ctx.close();
}

// Wardrobe + lookbook empty states at 0 pieces (and zero looks)
{
  const { ctx, page } = await boot(browser, 0, 1280, { looks: false });
  await page.evaluate(() => window.App && App.showWardrobe && App.showWardrobe());
  await page.waitForTimeout(900);
  // De-dupe pass (Annie, 2026-08-13): at zero pieces the hero invitation
  // is the WHOLE page — the milestone bar (home's learning meter carries
  // that promise) and the add-card grid (it returns with the first piece)
  // are gone.
  const w = await page.evaluate(() => ({
    headline: document.querySelector('#wg-grid div')?.textContent || '',
    hasBar: !!document.querySelector('#wg-grid .rb-ms'),
    ghosts: document.querySelectorAll('#wg-grid .rb-ghost-card').length,
    addCards: document.querySelectorAll('#wg-grid .rb-add-card').length,
    prose: (document.querySelector('#wg-grid p') || {}).textContent || '',
    tabs: Array.from(document.querySelectorAll('#wg-filters .wg-tab')).map((t) => t.textContent),
  }));
  check('wardrobe empty · serif line', /Every look starts with a photograph/.test(w.headline), w.headline.slice(0, 80));
  check('wardrobe empty · milestone bar gone — home carries the meter', !w.hasBar);
  check('wardrobe empty · no ghost tiles, no add-card duplication',
    w.ghosts === 0 && w.addCards === 0, JSON.stringify([w.ghosts, w.addCards]));
  check('wardrobe empty · no prose block', !w.prose, w.prose.slice(0, 60));
  check('wardrobe empty · tab row is All + ten categories + More, one line',
    w.tabs.length === 12 && w.tabs[0] === 'All' && /^More/.test(w.tabs[11]), JSON.stringify(w.tabs));

  await page.evaluate(() => window.__snOpen && window.__snOpen());
  await page.waitForTimeout(600);
  // ONE DOOR (FTUE pass 2026-08-12) — supersedes the "Ways to fill it"
  // clone shelf this section used to pin. An empty Lookbook IS the
  // composer: naming the first look is the one act that fills a Lookbook,
  // so it is the only thing on the page.
  const l = await page.evaluate(() => ({
    ways: !!document.getElementById('sn-ways'),
    emptyShown: document.getElementById('sn-empty')?.style.display !== 'none',
    composer: !!document.querySelector('.rb-lk-composer > .rb-lk-con'),
    titlePlaceholder: document.getElementById('rb-lk-newtitle')?.placeholder || '',
    // The four formula strips are the whole of the rack at zero
    strips: Array.from(document.querySelectorAll('.rb-lk-con .rbc-rolestrip span')).map((s) => s.textContent.trim()),
    ghostRows: document.querySelectorAll('.rb-lk-con .rbc-rghost').length,
    trailingAdd: !!document.querySelector('.rb-lk-con .rbc-addpiece'),
    save: !!document.querySelector('.rb-lk-save'),
    saveDisabled: document.querySelector('.rb-lk-save')?.disabled,
    door: document.querySelector('.rb-lk-robesdoor')?.textContent || '',
    // nothing competes with it
    bar: document.getElementById('rb-lk-bar')?.style.display !== 'none',
    hol: !!document.getElementById('rb-lk-hol'),
    allHead: document.getElementById('rb-lk-allhead')?.style.display !== 'none',
    sort: !!document.querySelector('.rb-lk-sort'),
  }));
  check('lookbook empty · ONE DOOR — the composer, no ways-to-fill shelf',
    l.composer === true && l.ways === false && l.emptyShown === false, JSON.stringify(l));
  check('lookbook empty · the name leads it', l.titlePlaceholder === 'Name your first look', l.titlePlaceholder);
  check('lookbook empty · the four formula strips are the rack',
    JSON.stringify(l.strips) === JSON.stringify(['The Canvas', 'The Anchor', 'The Texture', 'The Exclamation Point'])
      && l.ghostRows === 4, JSON.stringify([l.strips, l.ghostRows]));
  check('lookbook empty · the generic + Add a piece closes the rack', l.trailingAdd === true);
  // The name is the one gate (2026-09-03): Save stands there, live
  check('lookbook empty · Save stands there, live from the first second',
    l.save === true && l.saveDisabled === false, JSON.stringify([l.save, l.saveDisabled]));
  check('lookbook empty · no "Or let Robes build the first one" door (the prompt box is where Robes builds)',
    l.door === '', l.door);
  check('lookbook empty · nothing competes: no travel strip, All-looks header, sort or refine',
    l.bar === false && l.hol === false && l.allHead === false && l.sort === false,
    JSON.stringify([l.bar, l.hol, l.allHead, l.sort]));

  // No model on file: the canvas is the invitation to build one, and the
  // rack stays open under a hairline notice (2026-09-03).
  const noModel = await page.evaluate(() => ({
    prompt: !!document.querySelector('.rb-lk-con .rb-lkm-canvas.prompt'),
    ey: document.querySelector('.rb-lk-con .rb-lkm-ey')?.textContent,
    build: document.querySelector('.rb-lk-con .rb-lkm-build')?.textContent,
    orPhoto: document.querySelector('.rb-lk-con .rb-lkm-orphoto')?.textContent,
    notice: document.querySelector('.rb-lk-composer .rb-lkm-notice')?.textContent || '',
    ghostRows: document.querySelectorAll('.rb-lk-con .rbc-rghost').length,
  }));
  check('lookbook empty · with no model, the canvas asks for one',
    noModel.prompt === true && noModel.ey === 'No model yet' && noModel.build === 'Build your model'
      && noModel.orPhoto === 'Or start from your own photograph', JSON.stringify(noModel));
  check('lookbook empty · the rack stays open under the notice',
    /They stay on the rack, and your model wears them the moment she exists/.test(noModel.notice) && noModel.ghostRows === 4,
    JSON.stringify([noModel.notice, noModel.ghostRows]));

  await ctx.close();
}

// First load: opening the Lookbook before the 600ms concierge transform used
// to paint the legacy bundle trio into the ways block, correcting itself only
// on refresh. The ways block is gone from this page entirely (one door,
// 2026-08-12) — so the race is closed by construction, and what must hold is
// that the early open still lands the composer and never a legacy shelf.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  await page.route('**cdn.jsdelivr.net/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA_STUB }));
  await page.route('**ayowpaknssulsqqvwpqx.supabase.co/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**nominatim**', (r) => r.abort());
  await page.route('**open-meteo**', (r) => r.abort());
  await page.addInitScript(() => {
    window.__TEST_PROFILE = { first_name: 'Annie', style_dna: {}, wardrobe_items_count: 0,
      onboarded_at: '2026-07-01', gender_identity: 'woman', style_icons: [] };
    // Open the Lookbook the instant personalize exposes it — well inside the
    // 600ms window the concierge transform runs in.
    const t = setInterval(() => {
      if (window.__snOpen) { clearInterval(t); window.__snOpen(); }
    }, 10);
  });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => !!document.querySelector('.rb-lk-composer'), null, { timeout: 8000 });
  const early = await page.evaluate(() => {
    const ways = document.getElementById('sn-ways');
    const titles = ways ? Array.from(ways.querySelectorAll('.svc-title')).map((t) => t.textContent) : [];
    return { ways: !!ways, legacy: titles.some((t) => /key piece, three ways/i.test(t)), titles };
  });
  check('first load · an early open lands the composer, never a legacy shelf',
    early.ways === false && early.legacy === false, JSON.stringify(early.titles));

  // …and it must still be the composer once the transform lands, unchanged.
  await page.waitForTimeout(2200);
  const settled = await page.evaluate(() => ({
    ways: !!document.getElementById('sn-ways'),
    composer: !!document.querySelector('.rb-lk-composer > .rb-lk-con'),
    emptyShown: document.getElementById('sn-empty')?.style.display !== 'none',
  }));
  check('first load · the transform never displaces it',
    settled.composer === true && settled.ways === false && settled.emptyShown === false,
    JSON.stringify(settled));
  await ctx.close();
}

// Ways block disappears once anything is saved
{
  const { ctx, page } = await boot(browser, 1);
  await page.evaluate(() => {
    const k = 'robes_style_notes__u-test';
    // A daily look counts as Lookbook content; a key piece would not — it
    // lives on the Inspiration tab (IA refinement 2026-08-10).
    localStorage.setItem(k, JSON.stringify([{ id: 1, type: 'daily-look', title: 'A look', subtitle: '', img: null }]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__snOpen && window.__snOpen());
  await page.waitForTimeout(500);
  const gone = await page.evaluate(() => !document.getElementById('sn-ways'));
  check('lookbook · ways removed once content exists', gone);
  await ctx.close();
}

// FTU simplification (2026-08-18, W01/O1 + Annie's bare-page beta pass): at
// zero looks with NO styled card, the prompt LEADS the page in focus under
// the greeting's question; Build your own and The week ahead are hairlines
// that unfurl in place. The rack renders only when she asks.
{
  const { ctx, page, errs } = await boot(browser, 4, 1280, { looks: false });
  const h = await page.evaluate(() => {
    const dash = document.getElementById('dash');
    const rows = document.getElementById('rb-ftu-rows');
    const vis = (el) => !!el && el.offsetParent !== null;
    return {
      mode: rows?.getAttribute('data-mode'),
      rowIds: Array.from(rows?.querySelectorAll('.rb-ftu-row') || []).map((r) => r.id),
      order: Array.from(dash.children).map((e) => e.id || e.className.split(' ')[0])
        .filter((id) => ['concierge', 'rb-ftu-rows', 'services'].includes(id)),
      concEy: document.getElementById('rb-conc-ey')?.textContent,
      echo: dash.querySelector('.dash-echo')?.textContent,
      promptVisible: vis(document.getElementById('cb-ta')),
      railInWeekRow: !!document.querySelector('#rb-ftu-body-week #rb-rail'),
      // the rack is NOT rendered until she asks for it (W01 spec note)
      rackAbsent: !document.getElementById('rb-lkhome'),
      open: Array.from(document.querySelectorAll('.rb-ftu-row.open')).map((r) => r.id),
      // nothing competes: services, tracker, Lookbook + Inspiration rows
      servicesHidden: !vis(document.querySelector('.services')),
      trkHidden: document.getElementById('wtrk')?.style.display === 'none',
      snRowHidden: (document.getElementById('rb-sn')?.style.display === 'none')
        || !document.getElementById('rb-sn')?.textContent.trim(),
      wtrkCta: document.getElementById('wtrk-cta')?.offsetParent !== null,
      weekSub: document.querySelector('#rb-ftu-row-week .rb-ftu-sub')?.textContent,
    };
  });
  check('ftu rows · no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  check('ftu rows · without the styled card the prompt leads, the concierge band closes the page',
    h.mode === 'zero-lead' && JSON.stringify(h.order) === JSON.stringify(['concierge', 'rb-ftu-rows', 'services'])
      && h.concEy === 'Style something' && h.promptVisible === true
      && h.echo === 'What are you dressing for today?',
    JSON.stringify([h.mode, h.order, h.concEy, h.echo, h.promptVisible]));
  check('ftu rows · two hairlines beneath it, closed, the rail inside its row',
    JSON.stringify(h.rowIds) === JSON.stringify(['rb-ftu-row-build', 'rb-ftu-row-week'])
      && h.open.length === 0 && h.railInWeekRow === true,
    JSON.stringify([h.rowIds, h.open, h.railInWeekRow]));
  check('ftu rows · the rack is not rendered until she asks', h.rackAbsent === true);
  // Load rules (2026-08-19): the concierge STANDS beneath the rows from
  // the first session — tracker and Lookbook row still stand down.
  check('ftu rows · the concierge stands beneath the rows; tracker + Lookbook row stand down',
    h.servicesHidden === false && h.trkHidden === true && h.snRowHidden === true && h.wtrkCta === false,
    JSON.stringify([h.servicesHidden, h.trkHidden, h.snRowHidden, h.wtrkCta]));
  check('ftu rows · the week whisper is honest', h.weekSub === 'Nothing planned yet.', h.weekSub);

  // Build your own unfurls the rack in place
  const b = await page.evaluate(async () => {
    window.__rbFtuToggle('build');
    await new Promise((r) => setTimeout(r, 250));
    const el = document.getElementById('rb-lkhome');
    return {
      open: Array.from(document.querySelectorAll('.rb-ftu-row.open')).map((r) => r.id),
      inBuildRow: !!document.querySelector('#rb-ftu-body-build #rb-lkhome'),
      arrowBuild: document.querySelector('#rb-ftu-row-build .rb-ftu-arrow')?.textContent,
      count: el?.querySelector('.rb-lkh-count')?.textContent,
      ghostRows: el?.querySelectorAll('.rbc-rghost').length,
      snapWired: Array.from(el?.querySelectorAll('.rbc-rghost') || [])
        .every((r) => /__lkHomeSnap/.test(r.getAttribute('onclick') || '')),
      save: !!el?.querySelector('.rb-lk-save'),
      door: el?.querySelector('.rb-lk-robesdoor')?.textContent,
      composers: document.querySelectorAll('.rb-lk-composer').length,
      showMoreHidden: getComputedStyle(el.querySelector('.rb-lkh-showmore')).display === 'none',
    };
  });
  check('ftu rows · Build your own unfurls the rack in place',
    JSON.stringify(b.open) === JSON.stringify(['rb-ftu-row-build']) && b.inBuildRow === true
      && b.arrowBuild === '↑', JSON.stringify(b));
  check('ftu rows · four slots, every one of them the camera path',
    b.ghostRows === 4 && b.snapWired === true && b.count === '0 of 4 on the rack',
    JSON.stringify([b.ghostRows, b.snapWired, b.count]));
  check('ftu rows · carries Save, and no Robes door',
    b.save === true && b.door === undefined, JSON.stringify([b.save, b.door]));
  check('ftu rows · exactly one composer in the DOM', b.composers === 1, String(b.composers));
  check('ftu rows · all four slots render on web (no collapse)', b.showMoreHidden === true);

  // The week ahead unfurls the rail — the rack stays open beside it (rows
  // never close a sibling), and a second tap folds only that row.
  const w = await page.evaluate(async () => {
    window.__rbFtuToggle('week');
    await new Promise((r) => setTimeout(r, 350));
    const allOpen = Array.from(document.querySelectorAll('.rb-ftu-row.open')).map((r) => r.id);
    const rackStays = !!document.querySelector('#rb-ftu-body-build #rb-lkhome');
    const railCards = document.querySelectorAll('#rb-ftu-body-week #rb-rail .rb-dc, #rb-ftu-body-week #rb-rail .rb-rc').length;
    const railHeadHidden = (() => {
      const hd = document.querySelector('#rb-rail .rb-rail-head');
      return !hd || getComputedStyle(hd).display === 'none';
    })();
    window.__rbFtuToggle('week');
    await new Promise((r) => setTimeout(r, 200));
    return {
      allOpen, rackStays, railCards, railHeadHidden,
      afterFold: Array.from(document.querySelectorAll('.rb-ftu-row.open')).map((r) => r.id),
    };
  });
  check('ftu rows · The week ahead unfurls the rail alongside the open rack',
    JSON.stringify(w.allOpen) === JSON.stringify(['rb-ftu-row-build', 'rb-ftu-row-week'])
      && w.rackStays === true && w.railCards === 7 && w.railHeadHidden === true, JSON.stringify(w));
  check('ftu rows · a second tap folds only that row',
    JSON.stringify(w.afterFold) === JSON.stringify(['rb-ftu-row-build']),
    JSON.stringify(w.afterFold));

  // The draft is SHARED with the Lookbook composer — never a second copy
  const shared = await page.evaluate(async () => {
    window.__lkApplyNew('w0');
    await new Promise((r) => setTimeout(r, 200));
    const onHome = document.querySelector('#rb-lkhome .rbc-rack .rbc-name')?.textContent;
    const count = document.querySelector('#rb-lkhome .rb-lkh-count')?.textContent;
    window.__snOpen();
    await new Promise((r) => setTimeout(r, 400));
    return {
      onHome, count,
      homeGone: !document.getElementById('rb-lkhome'),
      composers: document.querySelectorAll('.rb-lk-composer').length,
      inLookbook: document.querySelector('#rb-lk-body .rbc-rack .rbc-name')?.textContent,
    };
  });
  check('ftu rows · a piece added on home hangs in the rack and counts',
    shared.onHome === 'Piece 1' && shared.count === '1 of 4 on the rack', JSON.stringify(shared));
  check('ftu rows · the SAME draft continues in the Lookbook, never a second copy',
    shared.inLookbook === 'Piece 1' && shared.homeGone === true && shared.composers === 1,
    JSON.stringify(shared));

  // Saving the first look flips home to O7: the prompt leads as a card,
  // "Your looks" takes the hero slot, the rows shrink to build + week.
  const saved = await page.evaluate(async () => {
    window.__lkApplyNew('w1');
    window.__lkNewTitleInput('Terrace mornings');   // rule 02: the name is the gate
    window.__lkSave();
    await new Promise((r) => setTimeout(r, 300));
    window.__snClose();
    await new Promise((r) => setTimeout(r, 500));
    const dash = document.getElementById('dash');
    return {
      mode: document.getElementById('rb-ftu-rows')?.getAttribute('data-mode'),
      rowIds: Array.from(document.querySelectorAll('.rb-ftu-row')).map((r) => r.id),
      order: Array.from(dash.children).map((e) => e.id || e.className.split(' ')[0])
        .filter((id) => ['concierge', 'rb-firstlook', 'rb-ftu-rows'].includes(id)),
      concEy: document.getElementById('rb-conc-ey')?.textContent,
      flName: document.querySelector('.rb-fl-name')?.textContent,
      flCta: document.querySelector('.rb-fl-cta')?.textContent,
      weekSub: document.querySelector('#rb-ftu-row-week .rb-ftu-sub')?.textContent,
      trkHidden: document.getElementById('wtrk')?.style.display === 'none',
    };
  });
  check('ftu rows · the first save lands O7: prompt card, Your looks, two hairlines',
    saved.mode === 'look'
      && JSON.stringify(saved.rowIds) === JSON.stringify(['rb-ftu-row-build', 'rb-ftu-row-week'])
      && JSON.stringify(saved.order) === JSON.stringify(['concierge', 'rb-firstlook', 'rb-ftu-rows']),
    JSON.stringify(saved));
  check('ftu rows · the saved look is the card, all hers',
    saved.flName === 'Terrace mornings' && saved.flCta === 'Open →' && saved.concEy === 'Style something',
    JSON.stringify(saved));
  check('ftu rows · the week ahead stays a hairline until a second look',
    saved.weekSub === 'One look, unplanned.' && saved.trkHidden === true, JSON.stringify(saved));
  await ctx.close();
}

// The rows on a phone: unfurled rack collapses texture + finish, preview
// stands down; no horizontal overflow.
{
  const { ctx, page, errs } = await boot(browser, 4, 390, { looks: false });
  const m = await page.evaluate(async () => {
    window.__rbFtuToggle('build');
    await new Promise((r) => setTimeout(r, 300));
    const el = document.getElementById('rb-lkhome');
    const more = el?.querySelector('.rb-lkh-more');
    const showmore = el?.querySelector('.rb-lkh-showmore');
    return {
      shown: Array.from(el?.querySelectorAll('.rbc-rolestrip span') || [])
        .filter((s) => s.offsetParent !== null).map((s) => s.textContent.trim()),
      moreHidden: more ? getComputedStyle(more).display === 'none' : null,
      showmoreShown: showmore ? getComputedStyle(showmore).display !== 'none' : null,
      previewHidden: el?.querySelector('.rb-lk-con > div:first-child')?.offsetParent === null,
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  check('390px ftu rows · no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  check('390px ftu rows · canvas and anchor are the ask; texture + finish collapse',
    JSON.stringify(m.shown) === JSON.stringify(['The Canvas', 'The Anchor'])
      && m.moreHidden === true && m.showmoreShown === true, JSON.stringify(m));
  check('390px ftu rows · the preview is web-only here', m.previewHidden === true);
  check('390px ftu rows · no horizontal overflow', m.overflow === true);

  // Show expands for the session; a piece cast into a late role force-expands
  const opened = await page.evaluate(async () => {
    document.querySelector('.rb-lkh-showmore').click();
    await new Promise((r) => setTimeout(r, 200));
    const el = document.getElementById('rb-lkhome');
    return Array.from(el.querySelectorAll('.rbc-rolestrip span'))
      .filter((s) => s.offsetParent !== null).map((s) => s.textContent.trim());
  });
  check('390px ftu rows · Show reveals the other two slots',
    JSON.stringify(opened) === JSON.stringify(_RB_ROLE_NAMES), JSON.stringify(opened));
  await ctx.close();
}

// The styled card (W01/O1): one goal, one filled button. "See the full
// looks" is the single CTA; the piece count is a caption, never a second
// ask; the rows start closed beneath it.
{
  const { ctx, page, errs } = await boot(browser, 1, 1280, { looks: false });
  await page.evaluate(() => {
    sessionStorage.setItem('rb_onboard_piece', JSON.stringify({
      prompt: 'Acid green cropped jumper', photo: null, cataloged: true }));
    sessionStorage.setItem('rb_onboard_styled', JSON.stringify({
      prompt: 'Acid green cropped jumper', ts: Date.now(),
      data: { ways: [
        { title: 'Effortless Parisian Polish' }, { title: 'Modern Romantic Edge' }, { title: 'Curated Comfort' },
      ], generatedImages: [], fallback: false, photoUrl: null } }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  const s = await page.evaluate(() => {
    const card = document.getElementById('rb-styled');
    const open = document.getElementById('rb-styled-open');
    const filled = Array.from(document.querySelectorAll('#dash button'))
      .filter((btn) => btn.offsetParent !== null)
      .filter((btn) => {
        const bg = getComputedStyle(btn).backgroundColor;
        return bg === 'rgb(32, 32, 33)' || bg === 'rgb(0, 0, 0)';
      }).map((btn) => btn.textContent.trim());
    return {
      cardFirst: document.querySelector('.dash-mast')?.nextElementSibling?.id,
      rowsNext: card?.nextElementSibling?.id,
      title: card?.querySelector('div div div')?.textContent || card?.textContent.slice(0, 120),
      openFilled: open ? getComputedStyle(open).backgroundColor === 'rgb(32, 32, 33)' : false,
      addNext: !!document.getElementById('rb-styled-addnext'),
      foot: document.getElementById('rb-styled-foot')?.textContent,
      filledButtons: filled,
      echo: document.querySelector('.dash-echo')?.textContent,
      open: Array.from(document.querySelectorAll('.rb-ftu-row.open')).map((r) => r.id),
      mode: document.getElementById('rb-ftu-rows')?.getAttribute('data-mode'),
      rowIds: Array.from(document.querySelectorAll('.rb-ftu-row')).map((r) => r.id),
      concInStyleRow: !!document.querySelector('#rb-ftu-body-style .concierge'),
      servicesHidden: document.querySelector('.services')?.offsetParent === null,
    };
  });
  check('styled card · no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  check('styled card · the hero leads, the rows fall in beneath it',
    s.cardFirst === 'rb-styled' && s.rowsNext === 'rb-ftu-rows', JSON.stringify([s.cardFirst, s.rowsNext]));
  check('styled card · "See the full looks" is the one filled button, no add-next CTA',
    s.openFilled === true && s.addNext === false
      && s.filledButtons.length === 1 && /See the full looks/i.test(s.filledButtons[0] || ''),
    JSON.stringify([s.openFilled, s.addNext, s.filledButtons]));
  check('styled card · the piece count is a caption, and it borrows honestly',
    s.foot === 'One piece filed. Every look borrows the rest until you photograph your own.', s.foot);
  check('styled card · the masthead answers the state',
    s.echo === 'Your first piece is filed.', s.echo);
  check('styled card · every row starts closed — the card is the CTA',
    s.open.length === 0, JSON.stringify(s.open));
  check('styled card · all three rows stand, the prompt waiting behind its row',
    s.mode === 'zero'
      && JSON.stringify(s.rowIds) === JSON.stringify(['rb-ftu-row-build', 'rb-ftu-row-style', 'rb-ftu-row-week'])
      && s.concInStyleRow === true, JSON.stringify([s.mode, s.rowIds, s.concInStyleRow]));
  // Load rules (2026-08-19): the concierge waits ONLY while the styled
  // card is the hero — the click through to the full looks brings it in.
  check('styled card · the concierge waits behind the hero',
    s.servicesHidden === true, String(s.servicesHidden));
  // The saved key piece IS the hero card — the Inspiration row would be a
  // second copy of it, so it stands down only while the card is up.
  const inspWhileCard = await page.evaluate(() =>
    document.getElementById('rb-insp-row')?.offsetParent === null
      || !document.getElementById('rb-insp-row')?.textContent.trim());
  check('styled card · the Inspiration row yields to the hero (one copy of the piece)',
    inspWhileCard === true, String(inspWhileCard));

  // Opening a row compacts the card to its header line (O1b), and the
  // composer's fallback points back at the three looks, never a fresh
  // generation.
  const c = await page.evaluate(async () => {
    window.__rbFtuToggle('build');
    await new Promise((r) => setTimeout(r, 250));
    return {
      compact: document.getElementById('rb-styled')?.classList.contains('rb-styled-compact'),
      tilesHidden: document.getElementById('rb-styled-tiles')?.offsetParent === null,
      door: document.querySelector('#rb-lkhome .rb-lk-robesdoor')?.textContent,
    };
  });
  check('styled card · an open row compacts it to the header line',
    c.compact === true && c.tilesHidden === true, JSON.stringify(c));
  check('styled card · the rack carries no Robes door (2026-09-03)',
    c.door === undefined, String(c.door));

  // Opening the looks retires the card — home re-decides, and the prompt
  // steps out to lead the page (never a bare index with no door).
  const after = await page.evaluate(async () => {
    document.getElementById('rb-styled-open')?.click();
    await new Promise((r) => setTimeout(r, 900));
    const filled = (id) => {
      const b = document.getElementById(id);
      return b ? getComputedStyle(b).backgroundColor === 'rgb(32, 32, 33)' : null;
    };
    return {
      styledGone: !document.getElementById('rb-styled'),
      mode: document.getElementById('rb-ftu-rows')?.getAttribute('data-mode'),
      concLeads: document.querySelector('.concierge')?.parentNode?.id === 'dash'
        && !!document.getElementById('rb-conc-ey'),
      // Load rules (2026-08-19): the click through brings the concierge in
      servicesShown: document.querySelector('.services')?.offsetParent !== null,
      // 2B guide band on the first landing
      kpOpen: document.getElementById('kp-result-page')?.style.display === 'block',
      band: !!document.getElementById('kp-guide-band'),
      bandText: (document.getElementById('kp-guide-band')?.textContent || '').replace(/\s+/g, ' '),
      firstFilled: filled('kp-build-btn-0'),
      secondFilled: filled('kp-build-btn-1'),
    };
  });
  check('styled card · once it retires the prompt steps out to lead',
    after.styledGone === true && after.mode === 'zero-lead' && after.concLeads === true,
    JSON.stringify([after.styledGone, after.mode, after.concLeads]));
  check('styled card · the concierge loads the moment she clicks through',
    after.servicesShown === true, String(after.servicesShown));
  check('kp guide band · stands on the first landing, in the band cream register',
    after.kpOpen === true && after.band === true
      && /Start here/i.test(after.bandText)
      && /Pick one of the three looks below and build it around what’s yours — Robes borrows the rest\./.test(after.bandText)
      && /Or head home to catalogue your wardrobe and start a look of your own\./.test(after.bandText)
      && /Build a look/i.test(after.bandText) && /Home dashboard/.test(after.bandText),
    after.bandText.slice(0, 220));
  check('kp guide band · card 01 carries the ONE filled Build this look while the band is up',
    after.firstFilled === true && after.secondFilled === false,
    JSON.stringify([after.firstFilled, after.secondFilled]));

  // × dismisses — the fill reverts, the flag persists, and a reopen never
  // brings the band back (it survives a reload only UNTIL dismissed).
  const bandB = await page.evaluate(async () => {
    document.getElementById('kp-guide-close')?.click();
    await new Promise((r) => setTimeout(r, 120));
    const b0 = document.getElementById('kp-build-btn-0');
    const goneNow = !document.getElementById('kp-guide-band');
    const unfilled = b0 ? getComputedStyle(b0).backgroundColor !== 'rgb(32, 32, 33)' : null;
    const flag = !!localStorage.getItem('rb_kp_guide_done__u-test');
    window.__kpRenderResult(window.__lastKpData, 'Acid green cropped jumper',
      { intent: 'style', skipSave: true, savedId: null });
    await new Promise((r) => setTimeout(r, 200));
    return { goneNow, unfilled, flag, backAgain: !!document.getElementById('kp-guide-band') };
  });
  check('kp guide band · × dismisses, reverts the fill, and it never returns',
    bandB.goneNow === true && bandB.unfilled === true && bandB.flag === true && bandB.backAgain === false,
    JSON.stringify(bandB));
  await ctx.close();
}

// O7 — hero card retired, prompt leads: exactly one look, nothing planned.
{
  const { ctx, page, errs } = await boot(browser, 4, 1280, { looks: false });
  await page.evaluate(() => {
    localStorage.setItem('rb_looks__u-test', JSON.stringify([
      { id: 'lk-1', name: 'Effortless Parisian Polish', name_provisional: false, note: '', photo_url: null,
        tags: null, source: 'manual', origin_look_id: null, created_at: '2026-08-17T10:00:00.000Z',
        pieces: [
          { id: 'w0', slot: 'Top', position: 0, role: null },
          { id: 'w1', slot: 'Bottom', position: 1, role: null },
          { id: 'w2', slot: 'Shoes', position: 2, role: null }],
        proposals: [{ role: null, chip: 'Bag', cats: ['Bags'], opts: [{ name: 'A bag' }], oi: 0, saved: false, image_url: null }],
        wears: [] },
    ]));
    // A styled key piece lives on Inspiration — it must surface in the home
    // Inspiration row here (the styled card has retired, so no duplicate).
    localStorage.setItem('robes_style_notes__u-test', JSON.stringify([
      { id: 1754700000000, type: 'key-piece', title: 'Acid green cropped jumper', subtitle: 'Worn three ways',
        img: null, kpData: { ways: [] } },
    ]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  const o = await page.evaluate(() => {
    const dash = document.getElementById('dash');
    return {
      mode: document.getElementById('rb-ftu-rows')?.getAttribute('data-mode'),
      order: Array.from(dash.children).map((e) => e.id || e.className.split(' ')[0])
        .filter((id) => ['concierge', 'rb-firstlook', 'rb-ftu-rows'].includes(id)),
      concEy: document.getElementById('rb-conc-ey')?.textContent,
      styleRowGone: !document.getElementById('rb-ftu-row-style'),
      flEy: document.querySelector('.rb-fl-ey')?.textContent,
      flName: document.querySelector('.rb-fl-name')?.textContent,
      flMeta: document.querySelector('.rb-fl-meta')?.textContent,
      flCta: document.querySelector('.rb-fl-cta')?.textContent,
      flCap: document.querySelector('.rb-fl-cap')?.textContent,
      flBar: !!document.querySelector('.rb-fl-progress i'),
      flOpen: document.querySelector('.rb-fl-row')?.getAttribute('onclick'),
      weekSub: document.querySelector('#rb-ftu-row-week .rb-ftu-sub')?.textContent,
      trkHidden: document.getElementById('wtrk')?.style.display === 'none',
      snRowHidden: (document.getElementById('rb-sn')?.style.display === 'none')
        || !document.getElementById('rb-sn')?.textContent.trim(),
      servicesHidden: document.querySelector('.services')?.offsetParent === null,
      styled: !!document.getElementById('rb-styled'),
      inspShown: document.getElementById('rb-insp-row')?.offsetParent !== null
        && /Acid green cropped jumper/.test(document.getElementById('rb-insp-row')?.textContent || ''),
    };
  });
  check('O7 · no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  check('O7 · a saved key piece surfaces in the home Inspiration row',
    o.inspShown === true, String(o.inspShown));
  check('O7 · the prompt leads as a card, then Your looks, then the hairlines',
    o.mode === 'look' && JSON.stringify(o.order) === JSON.stringify(['concierge', 'rb-firstlook', 'rb-ftu-rows'])
      && o.concEy === 'Style something' && o.styleRowGone === true, JSON.stringify(o));
  check('O7 · the look she owns is the card, Finish it the only nudge',
    o.flEy === 'Your looks' && o.flName === 'Effortless Parisian Polish'
      && o.flMeta === '3 pieces yours · 1 borrowed' && o.flCta === 'Finish it'
      && /__lkCardOpen/.test(o.flOpen || ''), JSON.stringify(o));
  check('O7 · wardrobe progress is a caption on the look card, never a CTA',
    o.flCap === '4 pieces filed. At 15, Robes builds every look entirely from your own closet.'
      && o.flBar === true && o.trkHidden === true, JSON.stringify([o.flCap, o.flBar, o.trkHidden]));
  check('O7 · the week ahead stays a hairline, honestly whispered',
    o.weekSub === 'One look, unplanned.', o.weekSub);
  // Load rules (2026-08-19): the concierge stands on O7 too — only the
  // styled card ever delays it, and that card has retired here.
  check('O7 · Lookbook row + styled card stand down; the concierge stands',
    o.snRowHidden === true && o.servicesHidden === false && o.styled === false,
    JSON.stringify([o.snRowHidden, o.servicesHidden, o.styled]));

  // A planned day EXPOSES the week ahead by default (Annie, 2026-08-18):
  // pin the look to tomorrow and the row unfurls itself, whisper updated.
  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowISO = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await page.route('**planned_days**', (r) => {
    const u = r.request().url();
    // The Coming-up strip queries beyond the rail window — keep it empty.
    const body = u.includes('day_date=gt.') ? '[]' : JSON.stringify([
      { user_id: 'u-test', source_id: 'lk-1', source_type: 'look', day_index: 0, slot: 'day',
        day_date: tomorrowISO, status: 'planned', activity: 'Dinner with friends',
        headline: 'Effortless Parisian Polish', thumb_urls: [], item_ids: ['w0'], pinned: true,
        updated_at: new Date().toISOString() },
    ]);
    return r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  const wk = await page.evaluate(async () => {
    window._rbRailPaint();
    await new Promise((r) => setTimeout(r, 900));
    const row = document.getElementById('rb-ftu-row-week');
    return {
      open: row?.classList.contains('open'),
      sub: row?.querySelector('.rb-ftu-sub')?.textContent,
      quiet: row?.classList.contains('rb-quiet'),
      railVisible: document.querySelector('#rb-ftu-body-week #rb-rail')?.offsetParent !== null,
    };
  });
  check('O7 · a planned day exposes The week ahead by default',
    wk.open === true && wk.sub === 'One day planned.' && wk.quiet === false && wk.railVisible === true,
    JSON.stringify(wk));
  await ctx.close();
}

// A styled key piece rides its OWN Inspiration row on home, linked to the
// Inspiration tab — never the Lookbook row (Annie, 2026-08-12).
{
  // looks:false so boot's own seed can't overwrite this fixture on reload
  const { ctx, page, errs } = await boot(browser, 4, 1280, { looks: false });
  await page.evaluate(() => {
    localStorage.setItem('rb_looks__u-test', JSON.stringify([
      { id: 'lk-row', name: 'A look', name_provisional: false, note: '', photo_url: null,
        tags: null, climate_band: 'year_round', climate_source: 'derived', source: 'manual',
        origin_look_id: null, created_at: '2026-08-05T10:00:00.000Z',
        pieces: [{ id: 'w0', slot: 'Top', position: 0, role: null }, { id: 'w1', slot: 'Bottom', position: 1, role: null }],
        wears: [] },
    ]));
    localStorage.setItem('robes_style_notes__u-test', JSON.stringify([
      { id: 1754700000000, type: 'key-piece', title: 'Pink barrel-leg jeans', subtitle: 'Worn three ways', img: null, kpData: { piece_name: 'Pink barrel-leg jeans', the_looks: [], ways: [
        { title: 'The Art Gallery Opening', occasion: 'Effortless chic', outfit: 'A shirt.', why: 'Because.' },
        { title: 'Brunch in the City', occasion: 'Easy', outfit: 'A blazer.', why: 'Because.' },
        { title: 'Evening Cocktails', occasion: 'Sharp', outfit: 'A heel.', why: 'Because.' },
      ] } },
      { id: 1754690000000, type: 'travel-edit', title: 'Ibiza edit', subtitle: 'Travel edit', img: null,
        tvData: { capsule: [], looks: [], dateFrom: '2026-08-07', tripDays: 5 } },
    ]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  const k = await page.evaluate(() => {
    const ir = document.getElementById('rb-insp-row');
    const sn = document.getElementById('rb-sn');
    return {
      shown: !!ir && ir.style.display !== 'none',
      ey: ir?.querySelector('.rb-sec-ey')?.textContent,
      link: ir?.querySelector('.rb-sec-link')?.getAttribute('onclick'),
      title: ir?.querySelector('.rb-sn-title')?.textContent,
      type: ir?.querySelector('.rb-sn-type')?.textContent,
      kpInLookbookRow: /Pink barrel-leg/.test(sn?.textContent || ''),
      lookbookRowHasLook: /Ibiza edit/.test(sn?.textContent || ''),
      // A saved Look's card draws its piece MOSAIC — photo_url is rare on a
      // Look, and the row must never show a blank cream card for one.
      lookMosaic: !!sn?.querySelector('.rb-sn-card .rb-lk-mos'),
    };
  });
  check('inspiration row · no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  check('inspiration row · a key piece rides its own row under an Inspiration header',
    k.shown === true && k.ey === 'Inspiration' && k.title === 'Pink barrel-leg jeans' && k.type === 'Key piece',
    JSON.stringify(k));
  check('inspiration row · View all lands on the Inspiration tab',
    /__rbInspOpen/.test(k.link || ''), k.link);
  // The home row mirrors what the Lookbook holds: her looks and her travel
  // edits. Key pieces are Inspiration's; days are the Diary's.
  check('inspiration row · key pieces never enter the Lookbook row, which keeps its looks',
    k.kpInLookbookRow === false && k.lookbookRowHasLook === true, JSON.stringify(k));
  check('lookbook row · a saved look draws its piece mosaic, never a blank card',
    k.lookMosaic === true, JSON.stringify(k.lookMosaic));
  // …and the key-piece result lights Inspiration in the nav, not Lookbook
  const nav = await page.evaluate(async () => {
    window.__snOpenItem(1754700000000);
    await new Promise((r) => setTimeout(r, 1200));
    const kp = document.getElementById('kp-result-page');
    return {
      opened: !!kp && kp.style.display !== 'none',
      insp: document.getElementById('rb-tn-inspiration')?.classList.contains('active'),
      look: document.getElementById('rb-tn-lookbook')?.classList.contains('active'),
    };
  });
  check('inspiration row · a key-piece result lights Inspiration, not Lookbook',
    nav.opened === true && nav.insp === true && nav.look === false, JSON.stringify(nav));
  await ctx.close();
}

// The module retires (2a): once she has created one of each live edit — a
// daily look and a travel edit (the weekly planner is a coming-soon promo;
// it rejoins the condition when the track returns) — the whole concierge
// falls away at once, meter, receipt row and all. Nothing takes its place.
{
  const { ctx, page, errs } = await boot(browser, 6);
  await page.evaluate(() => {
    localStorage.setItem('robes_style_notes__u-test', JSON.stringify([
      { id: 1755400000000, type: 'daily-look', title: 'A day', subtitle: '', img: null, dlData: { items: [] } },
      { id: 1755300000000, type: 'travel-edit', title: 'Lisbon edit', subtitle: '', img: null,
        tvData: { capsule: [], looks: [], dateFrom: '2026-08-01', tripDays: 3 } },
    ]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  const r = await page.evaluate(() => ({
    services: document.querySelector('.services')?.offsetParent !== null,
    errsFree: true,
  }));
  check('concierge retires · no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  check('concierge retires · one of each live edit made — the module falls away whole',
    r.services === false, JSON.stringify(r));
  await ctx.close();
}

// The concierge cards are day doors (2026-08-18): Style today scopes the
// prompt to TODAY, Plan the week scopes it to TOMORROW — the day chip
// carries the date, her words carry the brief. Image window 260px.
{
  const { ctx, page, errs } = await boot(browser, 5);
  // Node and Chromium disagree on the en-GB comma — compare comma-free.
  const fmt = (off) => {
    const d = new Date(Date.now() + off * 86400000);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
  };
  const c = await page.evaluate(async () => {
    const imgH = Math.round(document.querySelector('.svc-daily .svc-img')?.getBoundingClientRect().height || 0);
    const wkCta = Array.from(document.querySelectorAll('.services-grid .svc'))
      .map((el) => ({ t: el.querySelector('.svc-title')?.textContent, cta: el.querySelector('.svc-cta')?.textContent.trim() }))
      .find((x) => x.t === 'Weekly planner')?.cta || '';
    document.querySelector('.svc-daily').click();
    await new Promise((r) => setTimeout(r, 300));
    const chip = document.getElementById('rb-scopechip');
    const daily = { on: chip?.classList.contains('on'), label: chip?.querySelector('.lbl')?.textContent,
      focused: document.activeElement?.id === 'cb-ta' };
    Array.from(document.querySelectorAll('.services-grid .svc'))
      .find((el) => el.querySelector('.svc-title')?.textContent === 'Weekly planner')?.click();
    await new Promise((r) => setTimeout(r, 300));
    const weekly = { on: chip?.classList.contains('on'), label: chip?.querySelector('.lbl')?.textContent };
    return { imgH, wkCta, daily, weekly };
  });
  check('concierge doors · no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  check('concierge doors · the image window is 260px', c.imgH === 260, String(c.imgH));
  check('concierge doors · the weekly CTA promises the day-chip reality (audit 7.1)',
    c.wkCta === 'Start with tomorrow', c.wkCta);
  check('concierge doors · Style today scopes the prompt to TODAY, in focus',
    c.daily.on === true && (c.daily.label || '').replace(/,/g, '') === fmt(0) && c.daily.focused === true,
    JSON.stringify([c.daily, fmt(0)]));
  check('concierge doors · Start-with-tomorrow scopes the prompt to TOMORROW',
    c.weekly.on === true && (c.weekly.label || '').replace(/,/g, '') === fmt(1), JSON.stringify([c.weekly, fmt(1)]));
  await ctx.close();
}

// Mobile
{
  const { ctx, page, errs } = await boot(browser, 1, 390);
  check('390px · no page errors', errs.length === 0, errs.join(' | ').slice(0, 160));
  const m = await page.evaluate(() => {
    const dash = document.getElementById('dash');
    return {
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      concFirst: dash?.querySelector('.dash-mast')?.nextElementSibling?.classList.contains('concierge'),
      trackerGone: document.getElementById('wtrk')?.offsetParent === null,
    };
  });
  check('390px · no horizontal overflow', m.overflow);
  check('390px · the prompt leads under the masthead', m.concFirst === true, String(m.concFirst));
  check('390px · no standalone learning card', m.trackerGone === true);
  await ctx.close();
}

await browser.close();
server.kill();

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? '  ok ' : 'FAIL '} ${r.name}${r.pass ? '' : '  → ' + r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
