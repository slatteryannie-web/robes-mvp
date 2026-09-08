// Looks harness — boots the real dashboard with Supabase + REST stubbed and
// walks the Look-as-entity surfaces: the Lookbook's All looks shelf (IA
// 2026-08-08 — looks moved out of the wardrobe), the sort toggle, Look
// detail with its actions, wear confirmation + the quiet undo, variant
// promotion, the New look composer, the Calendar tab and the empty-day
// wear-a-look door. Also pins the LookTile extraction (brief B2): a DayCard
// must render byte-identically to its pre-extraction markup.
// Run manually: npm i --no-save playwright && node scripts/looks_harness.mjs
// Set CHROME_PATH when playwright's bundled browser build isn't installed.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4323;
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

// A wardrobe wide enough to fill every composer slot and to offer alternates.
const PIECES = [
  { id: 'w-top1', label: 'Cream silk shirt',   category: 'Tops',        color: 'Cream',  price: 180 },
  { id: 'w-top2', label: 'Ribbed white tank',  category: 'Tops',        color: 'White',  price: 40 },
  { id: 'w-bot1', label: 'Barrel-leg jeans',   category: 'Bottoms',     color: 'Navy',   price: 220 },
  { id: 'w-bot2', label: 'Linen shorts',       category: 'Bottoms',     color: 'Cream',  price: 90 },
  { id: 'w-sho1', label: 'Flat leather sandals', category: 'Shoes',     color: 'Camel',  price: 160 },
  { id: 'w-sho2', label: 'Tan leather slides', category: 'Shoes',       color: 'Camel',  price: 120 },
  { id: 'w-bag1', label: 'Woven straw tote',   category: 'Bags',        color: 'Cream',  price: 140 },
  { id: 'w-bag2', label: 'Raffia basket bag',  category: 'Bags',        color: 'Camel',  price: 95 },
  { id: 'w-acc1', label: 'Gold hoops',         category: 'Accessories', color: 'Ochre',  price: 60 },
  { id: 'w-dre1', label: 'Bias slip dress',    category: 'Dresses',     color: 'Blush',  price: 240 },
];
// pics: how many pieces Robes has seen a photograph of. Robes never hangs a
// piece without one, so a build's behaviour turns on this.
let WARDROBE_PICS = 0;
function wardrobe() {
  return PIECES.map((p, i) => ({
    ...p, user_id: 'u-test', brand: 'Studio', notes: '',
    image_url: i < WARDROBE_PICS ? 'https://res.cloudinary.com/demo/image/upload/' + p.id + '.jpg' : null,
    times_worn: 0, item_dna: {}, hero_position: null, seasons: null, occasions: null,
    created_at: new Date(Date.now() - i * 1000).toISOString(),
  }));
}

// Seeded looks: one with history (promotion path), one never worn (sort path).
const SEED_LOOKS = [
  { id: 'lk-1', user_id: 'u-test', name: 'The Thursday one', name_provisional: false,
    note: 'Cream silk shirt with the barrel-leg jeans, flat leather sandals.',
    photo_url: null, source: 'wear', origin_look_id: null,
    created_at: '2026-07-20T10:00:00Z', updated_at: '2026-07-20T10:00:00Z' },
  { id: 'lk-2', user_id: 'u-test', name: 'The tank one', name_provisional: true,
    note: 'Ribbed white tank with the linen shorts, tan leather slides.',
    photo_url: null, source: 'wear', origin_look_id: null,
    created_at: '2026-07-22T10:00:00Z', updated_at: '2026-07-22T10:00:00Z' },
];
const SEED_PIECES = [
  { look_id: 'lk-1', wardrobe_item_id: 'w-top1', slot: 'Top', position: 0 },
  { look_id: 'lk-1', wardrobe_item_id: 'w-bot1', slot: 'Bottom', position: 1 },
  { look_id: 'lk-1', wardrobe_item_id: 'w-sho1', slot: 'Shoe', position: 2 },
  { look_id: 'lk-1', wardrobe_item_id: 'w-bag1', slot: 'Bag', position: 3 },
  { look_id: 'lk-2', wardrobe_item_id: 'w-top2', slot: 'Top', position: 0 },
  { look_id: 'lk-2', wardrobe_item_id: 'w-bot2', slot: 'Bottom', position: 1 },
  { look_id: 'lk-2', wardrobe_item_id: 'w-sho2', slot: 'Shoe', position: 2 },
];
const SEED_WEARS = [
  { id: 'we-1', look_id: 'lk-1', user_id: 'u-test', worn_on: '2026-07-23',
    piece_ids: ['w-top1', 'w-bot1', 'w-sho1', 'w-bag1'], source: 'looks', source_id: null,
    confirmed_at: '2026-07-23T18:00:00Z' },
  { id: 'we-2', look_id: 'lk-1', user_id: 'u-test', worn_on: '2026-07-09',
    piece_ids: ['w-top1', 'w-bot1', 'w-sho2', 'w-bag1'], source: 'looks', source_id: null,
    confirmed_at: '2026-07-09T18:00:00Z' },
];

// Every write the module makes is captured so the harness can assert on the
// payloads — that a wear is INSERTed and undone by DELETE (never updated), and
// that a promotion writes a new look rather than mutating the old one.
async function boot(browser, { width = 1280, looksTable = true, seed = true, dropCat = null, pics = 0, avatar = null } = {}) {
  WARDROBE_PICS = pics;
  const ctx = await browser.newContext({ viewport: { width, height: 1200 } });
  const page = await ctx.newPage();
  const writes = [];

  await page.route('**cdn.jsdelivr.net/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA_STUB }));

  await page.route('**ayowpaknssulsqqvwpqx.supabase.co/**', (r) => {
    const req = r.request();
    const u = req.url();
    const m = req.method();
    let postBody = null;
    if (m !== 'GET') {
      try { postBody = req.postDataJSON(); } catch (_) { postBody = req.postData(); }
      writes.push({ method: m, url: u.split('/rest/v1/')[1] || u, body: postBody });
    }
    const missing = () => r.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST205', message: 'Could not find the table \'public.looks\' in the schema cache' }),
    });
    if (/\/(looks|look_pieces|wears)\b/.test(u) && !looksTable) return missing();
    // PostgREST with Prefer: return=representation echoes the inserted row.
    // Returning [] made every _tgEnsure fall through to a re-read that also
    // returned [], so no tag ever got an id and its link was dropped.
    if (m !== 'GET') {
      const echo = /^tags\b/.test(u.split('/rest/v1/')[1] || '') && postBody
        ? JSON.stringify([Object.assign({ id: 'tag-' + (postBody.slug || 'x') }, postBody)])
        : '[]';
      return r.fulfill({ status: 201, contentType: 'application/json', body: echo });
    }
    let body = '[]';
    if (u.includes('wardrobe_items')) body = JSON.stringify(wardrobe().filter((w) => !dropCat || w.category !== dropCat));
    else if (u.includes('/profiles') && u.includes('avatar_id')) body = JSON.stringify(avatar ? [{ avatar_id: avatar }] : []);
    else if (u.includes('/looks')) body = JSON.stringify(seed ? SEED_LOOKS : []);
    else if (u.includes('look_pieces')) body = JSON.stringify(seed ? SEED_PIECES : []);
    else if (u.includes('/wears')) body = JSON.stringify(seed ? SEED_WEARS : []);
    return r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.route('**nominatim**', (r) => r.abort());
  await page.route('**open-meteo**', (r) => r.abort());

  await page.addInitScript(() => {
    window.__TEST_PROFILE = {
      first_name: 'Annie', last_name: '', mobile: '', style_icons: [], budget: null,
      wardrobe_description: '', style_dna: {}, wardrobe_items_count: 10,
      onboarded_at: '2026-07-01', gender_identity: 'woman',
    };
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
  });

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2800);
  return { ctx, page, errs, writes };
}

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); };

async function openLooks(page) {
  // The All looks shelf of the Lookbook — where looks live (IA 2026-08-08)
  await page.evaluate(() => window.__lkGo && window.__lkGo());
  await page.waitForTimeout(600);
}

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

// ─────────────────────────────────────────────────────────────────────────
// 1 · LookTile extraction — zero visual drift on the day surfaces (B2)
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs } = await boot(browser);
  check('boot · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));

  check('LookTile · the primitive is exposed for every look surface',
    await page.evaluate(() => !!(window._rbLookTile && window._rbLookTile.strip && window._rbLookTile.mosaic)));

  // The primitive, exercised through the same functions DayCard calls: prefix
  // `dc` must emit the day classes byte-for-byte, `lt` the look classes.
  const prim = await page.evaluate(() => {
    const LT = window._rbLookTile;
    return {
      dcStrip: LT.strip(['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg'], 5, 'dc'),
      evenStrip: LT.strip(['https://x/a.jpg', 'https://x/b.jpg'], 2, 'dc'),
      empty: LT.strip([], 0, 'dc'),
      dcTitle: LT.title('Studio', 'dc'),
      ltTitle: LT.title('Studio', 'lt', true),
      mosaic: LT.mosaic([{ url: 'https://x/a.jpg', name: 'A' }], {}),
      mosaic2: LT.mosaic([{ url: 'https://x/a.jpg', name: 'A' }, { url: 'https://x/b.jpg', name: 'B' }], {}),
      mosaic3: LT.mosaic([{ url: 'https://x/a.jpg', name: 'A' }, { url: 'https://x/b.jpg', name: 'B' }, { url: 'https://x/c.jpg', name: 'C' }], {}),
      mosaic5: LT.mosaic([1, 2, 3, 4, 5].map((k) => ({ url: 'https://x/' + k + '.jpg', name: 'P' + k })), {}),
      photo: LT.mosaic([], { photo: 'https://x/p.jpg', alt: 'A look' }),
    };
  });
  check('LookTile · a whole-look photo replaces the mosaic',
    /class="lt-photo" src="https:\/\/x\/p\.jpg"/.test(prim.photo || '') && !/<i[ >]/.test(prim.photo || ''),
    (prim.photo || '').slice(0, 160));
  // The mosaic fills, always (redesign 2026-08-18): the piece count decides
  // how the frame divides — no empty half, no letterboxed tile.
  check('LookTile · the mosaic subdivides to the pieces, never an empty half',
    /rb-lk-mos n1/.test(prim.mosaic) && (prim.mosaic.match(/<i/g) || []).length === 1
      && /rb-lk-mos n2/.test(prim.mosaic2) && (prim.mosaic2.match(/<i/g) || []).length === 2
      && /rb-lk-mos n3/.test(prim.mosaic3) && (prim.mosaic3.match(/<i/g) || []).length === 3
      && !/class="e"/.test(prim.mosaic + prim.mosaic2 + prim.mosaic3),
    (prim.mosaic || '').slice(0, 120) + ' | ' + (prim.mosaic3 || '').slice(0, 120));
  check('LookTile · four or more pieces take the quartet',
    !/n[123]/.test(prim.mosaic5) && (prim.mosaic5.match(/<i/g) || []).length === 4,
    (prim.mosaic5 || '').slice(0, 160));
  check('LookTile · no overflow chip when nothing is hidden',
    !/class="ov/.test(prim.evenStrip || ''), (prim.evenStrip || '').slice(0, 160));
  check('LookTile · strip emits dc-th with .t3 and both overflow chips',
    /class="dc-th"/.test(prim.dcStrip || '') && /class="t3"/.test(prim.dcStrip || '') &&
    /ov d">\+2/.test(prim.dcStrip || '') && /ov m">\+3/.test(prim.dcStrip || ''),
    (prim.dcStrip || '').slice(0, 180));
  check('LookTile · no pieces renders nothing', prim.empty === '', JSON.stringify(prim.empty));
  check('LookTile · dc title has no provisional class', prim.dcTitle === '<div class="dc-title">Studio</div>', prim.dcTitle);
  check('LookTile · lt title marks a provisional name', /class="lt-title prov"/.test(prim.ltTitle || ''), prim.ltTitle);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 2 · The Looks tab — grid, sort, tab semantics (A1)
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, writes } = await boot(browser);
  await openLooks(page);
  check('tab · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));

  const s = await page.evaluate(() => {
    const seg = !!document.getElementById('sn-viewseg');
    const tabs = Array.from(document.querySelectorAll('#rb-topnav .rb-tn-link')).map((b) => b.textContent);
    const dock = Array.from(document.querySelectorAll('#rb-dock .rb-dock-tab')).map((b) => b.id.replace('rb-dock-', ''));
    const vis = (id) => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
    return {
      seg, tabs, dock,
      tnLookbookOn: document.getElementById('rb-tn-lookbook')?.classList.contains('active'),
      tnDiaryOn: document.getElementById('rb-tn-diary')?.classList.contains('active'),
      shelves: !!document.getElementById('sn-tabs'),
      wsub: Array.from(document.querySelectorAll('#rb-wsub button')).map((b) => b.dataset.view),
      eyebrow: document.getElementById('sn-eyebrow')?.textContent,
      wrapVisible: vis('rb-lk-wrap'),
      itemGridHidden: !vis('sn-grid'),
      tiles: document.querySelectorAll('#rb-lk-grid .rb-lk-tile').length,
      addCard: !!document.querySelector('#rb-lk-grid .rb-add-card'),
      addCardText: document.querySelector('#rb-lk-grid .rb-add-card')?.textContent,
      rmx: document.querySelectorAll('#rb-lk-grid .rb-lk-rmx').length,
      wearBtns: document.querySelectorAll('#rb-lk-grid .rb-lk-wearx').length,
      titles: Array.from(document.querySelectorAll('#rb-lk-grid .lt-title')).map((t) => t.textContent),
      provisional: Array.from(document.querySelectorAll('#rb-lk-grid .lt-title.prov')).map((t) => t.textContent),
      mosaicCells: document.querySelectorAll('#rb-lk-grid .rb-lk-mos.n3 i').length,
      sortLabel: document.querySelector('.rb-lk-sort span')?.textContent,
      sortArrow: document.querySelector('.rb-lk-sort b')?.textContent,
      eyebrows: Array.from(document.querySelectorAll('#rb-lk-grid .lt-ey')).map((e) => e.textContent),
      cardDress: document.querySelectorAll('#rb-lk-grid .lt-card').length,
      path: location.pathname,
    };
  });
  check('shelf · the Diary is a nav tab (Lookbook · Diary · Wardrobe · Inspiration), no in-page segment; the Lookbook opens lit',
    s.seg === false && s.tabs.join(',') === 'Lookbook,Diary,Wardrobe,Inspiration'
      && s.dock.join(',') === 'home,lookbook,diary,wardrobe,inspiration'
      && s.tnLookbookOn === true && s.tnDiaryOn === false,
    JSON.stringify(s.seg));
  check('shelf · the type shelves are retired (one looks view)', s.shelves === false);
  check('shelf · the wardrobe holds pieces and wishlist only (Looks moved out)',
    s.wsub.join(',') === 'all,wishlist', JSON.stringify(s.wsub));
  check('shelf · the page eyebrow reads Lookbook', s.eyebrow === 'Lookbook', String(s.eyebrow));
  check('tab · looks surface shown, the item grid stands down',
    s.wrapVisible && s.itemGridHidden, JSON.stringify([s.wrapVisible, s.itemGridHidden]));
  check('tab · deep-linkable path', s.path === '/lookbook', s.path);
  check('grid · every look card carries the Wear verb', s.wearBtns === 2, String(s.wearBtns));
  check('grid · cards carry the type eyebrow in the shared card dress',
    s.eyebrows.every((e) => e === 'Look') && s.eyebrows.length === 2 && s.cardDress === 2,
    JSON.stringify([s.eyebrows, s.cardDress]));
  check('grid · one tile per look', s.tiles === 2, String(s.tiles));
  check('grid · a New look add card mirrors the pieces grid',
    s.addCard === true && /New look/.test(s.addCardText || ''), JSON.stringify([s.addCard, s.addCardText]));

  check('grid · a 3-piece look subdivides whole (n3: one spanning, two stacked)',
    s.mosaicCells === 3, String(s.mosaicCells));
  check('grid · provisional title renders provisional', s.provisional.length === 1 && s.provisional[0] === 'The tank one', JSON.stringify(s.provisional));
  check('sort · defaults to Last worn ↓', s.sortLabel === 'Last worn' && s.sortArrow === '↓', `${s.sortLabel} ${s.sortArrow}`);
  check('sort · worn look leads descending', s.titles[0] === 'The Thursday one', JSON.stringify(s.titles));

  const asc = await page.evaluate(() => {
    window.__lkSort();
    return {
      label: document.querySelector('.rb-lk-sort span')?.textContent,
      arrow: document.querySelector('.rb-lk-sort b')?.textContent,
      titles: Array.from(document.querySelectorAll('#rb-lk-grid .lt-title')).map((t) => t.textContent),
    };
  });
  check('sort · toggles to First worn ↑', asc.label === 'First worn' && asc.arrow === '↑', `${asc.label} ${asc.arrow}`);
  check('sort · never-worn leads ascending', asc.titles[0] === 'The tank one', JSON.stringify(asc.titles));

  // Tile metadata is hover-only on the pointer surfaces (title-only decision)
  const meta = await page.evaluate(() => {
    window.__lkSort();   // back to Last worn ↓
    const tile = Array.from(document.querySelectorAll('#rb-lk-grid .rb-lk-tile'))
      .find((t) => t.querySelector('.lt-title')?.textContent === 'The Thursday one');
    const el = tile && tile.querySelector('.lt-meta');
    return el ? { txt: el.textContent, opacity: getComputedStyle(el).opacity } : null;
  });
  check('grid · metadata is printed, like every neighbouring grid', meta && meta.opacity === '1', JSON.stringify(meta));
  // Wears lead the card (Look Rules E2) — the Lookbook is browsed by vibe
  // and read by how often a look is actually worn.
  check('grid · metadata leads with wears, then pieces and the last wear',
    !!meta && /2 wears · 4 pieces · last 23 Jul/.test(meta.txt), meta && meta.txt);

  // The grid bar (2026-08-07): + New look beside Refine, which filters the
  // grid on the looks' tag axes. "Formal / Gala" is a vocabulary pick no
  // fixture look can carry (stored or inherited), so the nothing-matches
  // state is deterministic.
  const bar = await page.evaluate(() => {
    const barEl = document.getElementById('rb-lk-bar');
    const newBtn = barEl && Array.from(barEl.querySelectorAll('button')).find((b) => /\+ New/.test(b.textContent));
    // Sort and Refine are inert below four looks (2026-08-12), and this
    // fixture holds two — pad the stream so the controls are live, then put
    // the shelf back. The padding is legacy 'look' items: a daily look is a
    // DAY and no longer rides this stream at all (Look Rules 1a).
    const prior = localStorage.getItem('robes_style_notes__u-test');
    const inertBefore = document.querySelector('.rb-lk-sort')?.disabled;
    localStorage.setItem('robes_style_notes__u-test', JSON.stringify([
      { id: 1754660000000, type: 'look', title: 'Pad one', subtitle: 'Look', img: null },
      { id: 1754660000001, type: 'look', title: 'Pad two', subtitle: 'Look', img: null },
    ]));
    window.__lkGo();
    const liveAfter = document.querySelector('.rb-lk-sort')?.disabled === false;
    window.__lkRefineToggle();
    const drawer = document.querySelector('.rb-lk-refwrap');
    const axes = drawer ? Array.from(drawer.querySelectorAll('.rb-lkref-ax')).map((e) => e.textContent) : [];
    const chip = drawer && drawer.querySelector('.rb-lkref-chip[data-val="occasion"]');
    if (chip) chip.click();
    const shown = document.querySelectorAll('#rb-lk-grid .rb-lk-tile').length;
    const none = /No looks carry those tags/.test(document.getElementById('rb-lk-grid').textContent);
    window.__lkRefineClear();
    const restored = document.querySelectorAll('#rb-lk-grid .rb-lk-tile').length;
    window.__lkRefineToggle();
    if (prior === null) localStorage.removeItem('robes_style_notes__u-test');
    else localStorage.setItem('robes_style_notes__u-test', prior);
    window.__lkGo();
    return { newBtn: !!newBtn, axes, shown, none, restored, inertBefore, liveAfter };
  });
  check('bar · the + New split button sits in the grid bar', bar.newBtn === true);
  check('bar · sort and Refine are inert below four looks and come live at four',
    bar.inertBefore === true && bar.liveAfter === true, JSON.stringify([bar.inertBefore, bar.liveAfter]));
  // ADR-002 §7: Light is deleted, and Vibe only renders once she has one —
  // the axis is her vocabulary, so an empty one is nothing to show.
  // The axis reads "Season", matching the wardrobe's own filter — one
  // vocabulary means one word for it. The column stays climate_band.
  check('bar · Refine opens the three axes — Season, Wear it for, Vibe',
    JSON.stringify(bar.axes) === JSON.stringify(['Season', 'Wear it for', 'Vibe']), JSON.stringify(bar.axes));
  // restored === 4: the two fixture looks plus the two padding artifacts,
  // which share the stream's card class
  check('bar · a pick filters; nothing-matches names itself; Clear restores',
    bar.shown === 0 && bar.none === true && bar.restored === 4, JSON.stringify(bar));

  // ── Vibe filters inside Refine (Annie, 2026-08-17) ──────────────────────
  // One filtering system: Vibe sits in the drawer under Season and Wear it
  // for — never a standing row of its own on the Lookbook. The vibe still
  // rides each card so a filtered set stays readable.
  const vibeRef = await page.evaluate(() => {
    // Give one fixture look a vibe and leave the other without; pad the
    // stream past four so the drawer is live (legacy look items — a daily
    // look is a day and no longer rides this stream).
    window.__lkOpen('lk-1');
    window.__lkTagsApply({ climate: 'spring_summer', wear: ['everyday'], vibe: ['powerhouse'] });
    const prior = localStorage.getItem('robes_style_notes__u-test');
    localStorage.setItem('robes_style_notes__u-test', JSON.stringify([
      { id: 1754660000010, type: 'look', title: 'Pad three', subtitle: 'Look', img: null },
      { id: 1754660000011, type: 'look', title: 'Pad four', subtitle: 'Look', img: null },
    ]));
    window.__lkGo();
    const noRow = !document.querySelector('.rb-lkvibe');
    const cardVibe = Array.from(document.querySelectorAll('#rb-lk-grid .lt-vibe')).map((v) => v.textContent);
    window.__lkRefineToggle();
    const drawer = document.querySelector('.rb-lk-refwrap');
    const axes = drawer ? Array.from(drawer.querySelectorAll('.rb-lkref-ax')).map((e) => e.textContent) : [];
    const chip = drawer && drawer.querySelector('.rb-lkref-chip[data-ax="vibe"][data-val="powerhouse"]');
    const label = chip ? chip.textContent : '';
    if (chip) chip.click();
    const shown = document.querySelectorAll('#rb-lk-grid .lt-card').length;
    window.__lkRefineClear();
    const restored = document.querySelectorAll('#rb-lk-grid .lt-card').length;
    window.__lkRefineToggle();
    if (prior === null) localStorage.removeItem('robes_style_notes__u-test');
    else localStorage.setItem('robes_style_notes__u-test', prior);
    window.__lkGo();
    return { noRow, cardVibe, axes, label, shown, restored };
  });
  check('vibe · no standing row — Vibe is a Refine axis under Season and Wear it for',
    vibeRef.noRow === true
      && JSON.stringify(vibeRef.axes) === JSON.stringify(['Season', 'Wear it for', 'Vibe']),
    JSON.stringify([vibeRef.noRow, vibeRef.axes]));
  check('vibe · the card carries it, labelled not slugged',
    JSON.stringify(vibeRef.cardVibe) === JSON.stringify(['Powerhouse']), JSON.stringify(vibeRef.cardVibe));
  check('vibe · picking it in the drawer filters the grid, and Clear restores',
    vibeRef.label === 'Powerhouse' && vibeRef.shown === 1 && vibeRef.restored === 4,
    JSON.stringify(vibeRef));

  // ONE vibe per look (1e) — picking a second REPLACES the first, or the
  // wear data stops being able to answer which register she actually wears.
  const oneVibe = await page.evaluate(() => {
    window.__lkOpen('lk-1');
    window.__lkTagsEdit();
    const sheet = document.getElementById('rb-tag-sheet');
    const groups = Array.from(sheet.querySelectorAll('div')).filter((d) =>
      /^Vibe/.test(d.querySelector('div')?.textContent || ''));
    const seeds = Array.from(sheet.querySelectorAll('button'))
      .filter((b) => ['Powerhouse', 'Chic', 'Undone', 'Polished', 'Easy', 'Romantic', 'Sharp', 'Quiet', 'Statement', 'Off-duty'].includes(b.textContent))
      .map((b) => b.textContent);
    const addChip = !!Array.from(sheet.querySelectorAll('button')).find((b) => b.textContent === '+ Add a vibe');
    // She already carries Powerhouse; picking Chic must REPLACE it.
    Array.from(sheet.querySelectorAll('button')).find((b) => b.textContent === 'Chic').click();
    window.__rbTagDone(true);
    window.__lkGo();
    const after = Array.from(document.querySelectorAll('#rb-lk-grid .lt-vibe')).map((v) => v.textContent);
    return { seeds, addChip, after, hasGroup: groups.length > 0 };
  });
  check('vibe · the ten ship as the starting set, plus a door to her own',
    oneVibe.seeds.length === 10 && oneVibe.addChip === true, JSON.stringify(oneVibe.seeds));
  check('vibe · picking another replaces it — a look never carries two',
    JSON.stringify(oneVibe.after) === JSON.stringify(['Chic']), JSON.stringify(oneVibe.after));

  // Delete runs LAST — it consumes the fixture
  check('grid · tiles carry the lookbook hover-✕', s.rmx === 2, String(s.rmx));
  const deleted = await page.evaluate(() => {
    window._rbConfirmDelete = (msg, cb) => { window.__lastConfirmMsg = msg; cb(); };
    const wrap = Array.from(document.querySelectorAll('.rb-lk-tilewrap'))
      .find((w) => w.querySelector('.lt-title')?.textContent === 'The tank one');
    wrap.querySelector('.rb-lk-rmx').click();
    return {
      msg: window.__lastConfirmMsg,
      tiles: document.querySelectorAll('#rb-lk-grid .rb-lk-tile').length,
    };
  });
  check('grid · ✕ deletes through the shared confirm',
    /Delete The tank one\?/.test(deleted.msg || '') && deleted.tiles === 1,
    JSON.stringify(deleted));
  await page.waitForTimeout(400);
  const delWrite = await page.evaluate(() => null);
  check('grid · the delete reaches the cloud',
    writes.some((w) => w.method === 'DELETE' && /^looks\?id=eq\.lk-2/.test(w.url)),
    JSON.stringify(writes.filter((w) => w.method === 'DELETE').map((w) => w.url)));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 3 · Look detail — the four actions, stats, wear + quiet undo (A3, A4)
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, writes } = await boot(browser);
  await openLooks(page);
  await page.evaluate(() => window.__lkOpen('lk-1'));
  await page.waitForTimeout(400);

  const d = await page.evaluate(() => ({
    back: !!document.querySelector('.rb-lk-back'),
    eyebrow: document.querySelector('.rb-lk-eyebrow')?.textContent,
    title: ((e) => e ? (e.tagName === 'INPUT' ? e.value : e.textContent) : null)(document.getElementById('rb-lk-title')),
    provisional: document.getElementById('rb-lk-title')?.classList.contains('prov'),
    stats: Array.from(document.querySelectorAll('.rb-lk-stat')).map((s) => [s.querySelector('b')?.textContent, s.querySelector('span')?.textContent]),
    actions: Array.from(document.querySelectorAll('.rb-lk-actrow button')).map((b) => b.textContent),
    pieceRows: document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-row').length,
    wearRows: document.querySelectorAll('.rb-lk-wear').length,
    wearLines: Array.from(document.querySelectorAll('.rb-lk-wear .pc')).map((t) => t.textContent.replace(/\s+/g, ' ')),
    gridHidden: document.getElementById('rb-lk-grid')?.style.display === 'none',
    boardTiles: document.querySelectorAll('.rb-lk-con .rbc-board .rbc-tile').length,
    boardN: document.querySelector('.rb-lk-con .rbc-board')?.dataset.n,
    headLabel: document.querySelector('.rb-lk-con .rbc-lhead .lab')?.textContent,
    quote: document.querySelector('.rb-lk-con .rbc-quote')?.textContent,
    yours: document.querySelector('.rb-lk-con .rbc-yours')?.textContent,
    lookv2: document.body.classList.contains('rb-lookv2'),
    deleteLink: !!Array.from(document.querySelectorAll('.rb-lk-quiet')).find((b) => b.textContent === 'Delete this look'),
    inlineStrip: !!document.querySelector('.rb-lk-con .rb-lk-pick'),
    flicks: document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-arrow').length,
    rowSwaps: document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-act').length,
  }));
  check('detail · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  check('detail · no sub-sub-nav back line', d.back === false);
  check('detail · grid yields to the detail', d.gridHidden === true);
  const tabBack = await page.evaluate(() => {
    document.getElementById('rb-tn-lookbook').click();
    return {
      gridShown: document.getElementById('rb-lk-grid')?.style.display !== 'none',
      tiles: document.querySelectorAll('#rb-lk-grid .rb-lk-tile').length,
    };
  });
  check('detail · tapping the Lookbook tab lands the landing grid',
    tabBack.gridShown && tabBack.tiles === 2, JSON.stringify(tabBack));
  await page.evaluate(() => window.__lkOpen('lk-1'));
  await page.waitForTimeout(200);
  check('detail · named title is not provisional', d.title === 'The Thursday one' && d.provisional === false, `${d.title}/${d.provisional}`);
  // The page is the look and its history — the eyebrow says so (1c).
  check('detail · eyebrow reads Saved look', d.eyebrow === 'Saved look', d.eyebrow);
  // C1's action pair: an outlined "Wear today" pill and the circled
  // calendar for a future day — black stays reserved for the one real
  // commitment on a screen, and reading a look is not one.
  const actrow = await page.evaluate(() => {
    const w = document.querySelector('.rb-lk-wearbtn');
    const c = document.querySelector('.rb-lk-calbtn');
    if (!w || !c) return null;
    const cs = getComputedStyle(w);
    const cc = getComputedStyle(c);
    return {
      wear: w.textContent, bg: cs.backgroundColor, color: cs.color,
      calRound: cc.borderRadius, calTitle: c.getAttribute('title'),
    };
  });
  check('detail · Wear today is the outlined pill, the calendar the circle (C1)',
    !!actrow && actrow.wear === 'Wear today' && !/\b32, 32, 33\b/.test(actrow.bg)
      && /\b32, 32, 33\b/.test(actrow.color) && actrow.calRound === '50%'
      && /Wear on a day/.test(actrow.calTitle || ''),
    JSON.stringify(actrow));
  const layout = await page.evaluate(() => {
    const mast = document.querySelector('.rb-lk-mast');
    const con = document.querySelector('.rb-lk-con');
    const rack = con?.querySelector('.rbc-rack');
    const stats = con?.querySelector('.rb-lk-ledger');
    return {
      mastFirst: !!(mast && con) && !!(mast.compareDocumentPosition(con) & Node.DOCUMENT_POSITION_FOLLOWING),
      titleInMast: !!mast?.querySelector('#rb-lk-title'),
      pencil: !!mast?.querySelector('.rb-rename-tbtn'),
      rackLabel: con?.querySelector('.rb-lk-sec')?.textContent,
      statsBelowRack: !!(rack && stats) && !!(rack.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  check('detail · the name leads the page (masthead above the console)', layout.mastFirst && layout.titleInMast, JSON.stringify(layout));
  check('detail · rename is the pencil, not a standing input', layout.pencil === true);
  check('detail · the card list is The Rack, and offers Edit & resave',
    /^The Rack · 4 pieces/.test(layout.rackLabel || '') && /Edit & resave/.test(layout.rackLabel || ''),
    String(layout.rackLabel));
  check('detail · the ledger card lives below the Rack', layout.statsBelowRack === true);
  const renamed = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__lkTitleEdit();
    await wait(120);
    const inp = document.getElementById('rb-lk-title');
    const isInput = !!inp && inp.tagName === 'INPUT';
    if (isInput) { inp.value = 'Thursday, renamed'; window.__lkTitleCommit(inp.value); }
    await wait(120);
    const mid = document.getElementById('rb-lk-title');
    const out = { isInput, tag: mid?.tagName, title: mid?.textContent };
    window.__lkTitleEdit();
    await wait(120);
    const back = document.getElementById('rb-lk-title');
    if (back && back.tagName === 'INPUT') { back.value = 'The Thursday one'; window.__lkTitleCommit(back.value); }
    await wait(120);
    return out;
  });
  check('detail · pencil opens the inline input', renamed.isInput === true);
  check('detail · commit lands the name back as the static title',
    renamed.tag === 'H2' && renamed.title === 'Thursday, renamed', JSON.stringify(renamed));
  // Wears / Last worn / Pieces / Saved — the ledger a look earns by being
  // saved (rule 03); "Saved" is the day the counter started.
  check('detail · the ledger reads wears, last worn, pieces, saved',
    JSON.stringify(d.stats.slice(0, 4)) === JSON.stringify([['2', 'Wears'], ['23 Jul', 'Last worn'], ['4', 'Pieces'], ['20 Jul', 'Saved']]),
    JSON.stringify(d.stats));
  check('detail · cost per wear derives from priced pieces (700/2)',
    d.stats.some((s) => s[1] === 'Per wear' && s[0] === '€350'), JSON.stringify(d.stats));
  check('detail · every piece is a shared rack row', d.pieceRows === 4, String(d.pieceRows));
  // The saved rack READS by default (1c) — the piece's own wear count where
  // the flick cluster and Swap sit once she asks to edit.
  check('detail · the rack reads until she asks to edit it',
    d.flicks === 0 && d.rowSwaps === 0, JSON.stringify([d.flicks, d.rowSwaps]));
  check('detail · the inline swap strip is gone', d.inlineStrip === false);
  const editMode = await page.evaluate(() => {
    const wearsBefore = Array.from(document.querySelectorAll('.rbc-rack .rbc-wears')).map((e) => e.textContent.trim());
    window.__lkEditToggle();
    const out = {
      wearsBefore,
      flicks: document.querySelectorAll('.rbc-rack .rbc-arrow').length,
      swaps: Array.from(document.querySelectorAll('.rbc-rack .rbc-act')).filter((b) => /Swap/.test(b.textContent)).length,
      label: document.querySelector('.rb-lk-con .rb-lk-sec button')?.textContent,
    };
    window.__lkEditToggle();
    return out;
  });
  check('detail · reading, each row carries its piece\'s wear count',
    editMode.wearsBefore.length === 4 && /wear/.test(editMode.wearsBefore[0] || ''), JSON.stringify(editMode.wearsBefore));
  check('detail · Edit & resave brings the flick cluster and Swap back',
    editMode.flicks === 8 && editMode.swaps === 4 && editMode.label === 'Done editing', JSON.stringify(editMode));
  check('detail · The Look is the standing 4:5 board',
    d.lookv2 && d.boardTiles === 4 && d.boardN === '4', JSON.stringify([d.lookv2, d.boardTiles, d.boardN]));
  check('detail · the panel head is the console\'s', d.headLabel === 'The look · 4 pieces', d.headLabel);
  check('detail · the styling note rides the panel quote slot', /Cream silk shirt with/.test(d.quote || ''), d.quote);
  check('detail · ownership line is the canonical copy', /4.of.4 from your wardrobe/.test(d.yours || ''), d.yours);
  check('detail · a quiet delete exists', d.deleteLink === true);
  check('detail · wear history lists both wears', d.wearRows === 2, String(d.wearRows));
  // The mock's worn rows carry no chips — the difference is named in the
  // line itself: "…instead of the…", or "Worn as saved".
  check('detail · a wear whose snapshot differs names the difference in the line',
    d.wearLines.some((x) => x === 'Worn as saved') && d.wearLines.some((x) => /instead of the/.test(x)),
    JSON.stringify(d.wearLines));

  // Formula strips + look tags (Look Template spec A3 + F, 2026-08-07)
  const specA3F = await page.evaluate(() => {
    const strips = Array.from(document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-rolestrip span')).map((s) => s.textContent);
    const tagsRow = document.querySelector('.rb-lk-con .rbc-tags');
    return {
      strips,
      stripsLeadRows: (() => {
        const rack = document.querySelector('.rb-lk-con .rbc-rack');
        return rack && rack.firstElementChild && rack.firstElementChild.classList.contains('rbc-rolestrip');
      })(),
      tagsRow: !!tagsRow,
      tagsEmptyInvite: tagsRow ? /Untagged|Tags/.test(tagsRow.textContent) : false,
    };
  });
  check('roles · the rack groups under hairline formula strips', specA3F.strips.length >= 2 && specA3F.stripsLeadRows, JSON.stringify(specA3F.strips));
  check('roles · display order is Canvas before Anchor before finishers',
    specA3F.strips.indexOf('The Canvas') === 0
      && specA3F.strips.indexOf('The Anchor') === 1, JSON.stringify(specA3F.strips));
  check('tags · The Look carries the quiet tag row', specA3F.tagsRow === true);
  check('tags · untagged is an invitation, never a form', specA3F.tagsEmptyInvite === true);

  // The tag sheet: open on the untagged look → the inherited seed shows →
  // Done persists a flat text[] to the looks table (spec F2/F3)
  const tagged = await page.evaluate(() => {
    window.__lkTagsEdit();
    const sheet = document.getElementById('rb-tag-sheet');
    const groups = sheet ? Array.from(sheet.querySelectorAll('div > div[style*="uppercase"], div[style*="letter-spacing"]')).map((e) => e.textContent).join('|') : '';
    // ADR-002: picks are by SLUG now, not by index into a fixed list
    window.__rbTagPick('climate', 'spring_summer');
    window.__rbTagPick('wear', 'occasion');
    window.__rbTagDone(true);
    const row = document.querySelector('.rb-lk-con .rbc-tags');
    return { hadSheet: !!sheet, groups, rowText: row ? row.textContent : '' };
  });
  check('tags · the sheet opens on the three surviving axes, Light gone',
    tagged.hadSheet && /Season/.test(tagged.groups) && /Wear it for/.test(tagged.groups)
      && /Vibe/.test(tagged.groups) && !/Light/.test(tagged.groups)
      && !/Climate/.test(tagged.groups), tagged.groups.slice(0, 200));
  check('tags · picks land back on the row', /Spring\/Summer/.test(tagged.rowText) && /Occasion/.test(tagged.rowText), tagged.rowText);
  await page.waitForTimeout(400);
  // Climate is a COLUMN now, and her edit is permanent: climate_source flips
  // to 'user' and the look is never re-derived again. Wear and Vibe go to the
  // shared namespace (tag_looks), not onto the looks row.
  const tagWrite = writes.find((w) => w.method === 'PATCH' && /^looks\?/.test(w.url) && w.body && w.body.climate_band);
  check('tags · the edit PATCHes climate_band and marks the override hers',
    !!tagWrite && tagWrite.body.climate_band === 'spring_summer' && tagWrite.body.climate_source === 'user',
    JSON.stringify(tagWrite && tagWrite.body));
  const linkWrite = writes.find((w) => w.method === 'POST' && /^tag_looks/.test(w.url));
  check('tags · wear/vibe land in the shared namespace, not on the look row',
    !!linkWrite, JSON.stringify(writes.filter(w => w.method === 'POST').map(w => w.url)));

  // Custom tags (F2 "+ tag" amendment, 2026-08-07): Wear and Vibe are open
  // axes — a typed tag chips in, and a custom vibe stores with the vibe:
  // prefix so the flat array stays unambiguous.
  const custom = await page.evaluate(() => {
    window.__lkTagsEdit();
    const sheet = document.getElementById('rb-tag-sheet');
    const dashed = sheet ? sheet.querySelectorAll('button[onclick*="__rbTagAdd"]').length : 0;
    window.__rbTagAdd('vibe');
    const hadInput = !!document.querySelector('#rb-tag-newin');
    window.__rbTagCommit('vibe', 'Quiet Luxury');
    window.__rbTagDone(true);
    const row = document.querySelector('.rb-lk-con .rbc-tags');
    return { dashed, hadInput, rowText: row ? row.textContent : '' };
  });
  check('tags · Wear and Vibe carry the dashed + tag door', custom.dashed === 2, String(custom.dashed));
  check('tags · a typed tag becomes an inline input, then a chip on the row',
    custom.hadInput === true && /Quiet Luxury/.test(custom.rowText), custom.rowText);
  await page.waitForTimeout(400);
  // The 'vibe:' prefix was a workaround for packing four axes into one flat
  // text[]. With a real namespace the axis is carried by tags.kind, so the
  // custom vibe is minted as its own row and slugged.
  const vibeTag = writes.find((w) => w.method === 'POST' && /^tags/.test(w.url)
    && w.body && w.body.kind === 'vibe');
  check('tags · a custom vibe mints a namespace row, slugged, no prefix',
    !!vibeTag && vibeTag.body.slug === 'quiet-luxury' && vibeTag.body.label === 'Quiet Luxury'
      && vibeTag.body.is_seed === false,
    JSON.stringify(vibeTag && vibeTag.body));

  // Drag & drop role casting (A3 amendment, 2026-08-07): every rack row is
  // draggable, a drop under a strip re-casts freely — the strips educate,
  // they never constrain — and the cast persists on look_pieces.role.
  const cast = await page.evaluate(() => {
    const wraps = document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-dragrow[draggable="true"]');
    const name0 = document.querySelector('.rb-lk-con .rbc-rack .rbc-dragrow[data-roledrag="0"] .rbc-name')?.textContent;
    window.__lkDRoleDrop(0, 'The Exclamation Point');
    const rack = document.querySelector('.rb-lk-con .rbc-rack');
    const names = [];
    let inGroup = false;
    Array.from(rack.children).forEach((el) => {
      if (el.classList.contains('rbc-rolestrip')) inGroup = el.textContent.trim() === 'The Exclamation Point';
      else if (inGroup) { const n = el.querySelector('.rbc-name'); if (n) names.push(n.textContent); }
    });
    return { draggable: wraps.length, name0, names };
  });
  check('roles · every rack row is draggable', cast.draggable === 4, String(cast.draggable));
  check('roles · a drop re-casts the piece under the target strip',
    !!cast.name0 && cast.names.includes(cast.name0), JSON.stringify(cast));
  await page.waitForTimeout(400);
  const roleWrite = writes.filter((w) => w.method === 'POST' && /^look_pieces/.test(w.url)).pop();
  const roleRows = roleWrite && (Array.isArray(roleWrite.body) ? roleWrite.body : [roleWrite.body]);
  check('roles · the cast persists on look_pieces.role',
    !!roleRows && roleRows.some((r) => r.role === 'The Exclamation Point'), JSON.stringify(roleRows));


  // The tap IS the wear, with a quiet undo on the card (A4/C1)
  const worn = await page.evaluate(() => {
    document.querySelector('.rb-lk-wearbtn').click();
    return {
      wears: document.querySelectorAll('.rb-lk-stat')[0]?.querySelector('b')?.textContent,
      undo: !!Array.from(document.querySelectorAll('.rb-lk-quiet')).find((b) => b.textContent === 'Not this, actually'),
      dialog: !!document.querySelector('.sheet-overlay.open'),
      wearRows: document.querySelectorAll('.rb-lk-wear').length,
      primaryDisabled: !!document.querySelector('.rb-lk-wearbtn[disabled]'),
    };
  });
  check('wear · a tap creates the wear with no confirm dialog', worn.wears === '3' && !worn.dialog, JSON.stringify(worn));
  check('wear · undo is a quiet affordance on the card, not a toast', worn.undo === true);
  check('wear · the action settles to Worn today ✓', worn.primaryDisabled === true);
  check('wear · history gains the row', worn.wearRows === 3, String(worn.wearRows));

  await page.waitForTimeout(500);
  const wearWrite = writes.find((w) => w.method === 'POST' && /^wears/.test(w.url));
  check('wear · INSERTs a wear row with a piece snapshot',
    !!wearWrite && Array.isArray(wearWrite.body?.piece_ids) && wearWrite.body.piece_ids.length === 4,
    JSON.stringify(wearWrite?.body || null));
  check('wear · bumps times_worn on the pieces',
    writes.filter((w) => w.method === 'PATCH' && /wardrobe_items/.test(w.url)).length === 4,
    String(writes.filter((w) => w.method === 'PATCH' && /wardrobe_items/.test(w.url)).length));

  const undone = await page.evaluate(() => {
    Array.from(document.querySelectorAll('.rb-lk-quiet')).find((b) => b.textContent === 'Not this, actually').click();
    return {
      wears: document.querySelectorAll('.rb-lk-stat')[0]?.querySelector('b')?.textContent,
      backToPrimary: document.querySelector('.rb-lk-wearbtn')?.textContent,
    };
  });
  check('undo · the count returns', undone.wears === '2', String(undone.wears));
  check('undo · Wear today comes back', undone.backToPrimary === 'Wear today', String(undone.backToPrimary));
  await page.waitForTimeout(500);
  check('undo · corrects by DELETE, never an update to a wear',
    writes.some((w) => w.method === 'DELETE' && /^wears/.test(w.url)) &&
    !writes.some((w) => w.method === 'PATCH' && /^wears/.test(w.url)),
    JSON.stringify(writes.filter((w) => /^wears/.test(w.url)).map((w) => w.method)));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 4 · Swap → variant promotion (A5) and the pin (A3)
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, writes } = await boot(browser);
  await openLooks(page);
  await page.evaluate(() => window.__lkOpen('lk-1'));
  await page.waitForTimeout(300);

  const swap = await page.evaluate(() => {
    window.__lkDSwap(3);   // the tote
    const modal = document.getElementById('lkd-swap-modal');
    return {
      open: !!modal,
      candidate: /Raffia basket bag/.test(modal?.textContent || ''),
      snap: /Snap mine/.test(modal?.textContent || ''),
    };
  });
  check('swap · opens the SAME modal the consoles use', swap.open === true);
  check('swap · her wardrobe by category, plus Snap mine',
    swap.candidate === true && swap.snap === true, JSON.stringify(swap));

  // Edits land LIVE on the view (Annie's beta pass 2026-08-17) — the swap
  // shows immediately on the mosaic and the rack, the saved look is
  // untouched, and a quiet strip (the day banner's register) carries the
  // ways out: discard, update, or save as a new look (D2's question).
  const liveEdit = await page.evaluate(() => {
    window.__lkEditToggle();
    window.__lkDSwapApply(3, 'w-bag2');
    const bar = document.querySelector('.rb-lk-editbar');
    return {
      bar: (bar?.textContent || '').replace(/\s+/g, ' '),
      acts: Array.from(bar?.querySelectorAll('button') || []).map((x) => x.textContent),
      pieces: Array.from(document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-name')).map((x) => x.textContent),
      boardN: document.querySelectorAll('.rb-lk-con .rbc-board .rbc-tile').length,
      modalGone: !document.getElementById('lkd-swap-modal'),
    };
  });
  check('live edit · the swap shows in real time on the rack',
    liveEdit.pieces.includes('Raffia basket bag') && !liveEdit.pieces.includes('Woven straw tote')
      && liveEdit.modalGone,
    JSON.stringify(liveEdit.pieces));
  check('live edit · one quiet strip says the wears stand until she updates',
    /One change to this look/.test(liveEdit.bar) && /2 wears stay with it/.test(liveEdit.bar),
    liveEdit.bar.slice(0, 140));
  check('live edit · the strip offers Discard / Update / Save as a new look',
    liveEdit.acts.join(' | ') === 'Discard | Update this look | Save as a new look', JSON.stringify(liveEdit.acts));
  await page.waitForTimeout(400);
  check('live edit · the saved look is untouched while the strip stands',
    !writes.some((w) => w.method === 'DELETE' && /look_pieces\?look_id=eq\.lk-1/.test(w.url)),
    JSON.stringify(writes.filter((w) => /look_pieces/.test(w.url)).map((w) => w.method + ' ' + w.url)));

  // Save as a new look — the D2 modal: the question, and the NAME (rule 02)
  const promoted = await page.evaluate(async () => {
    window.__lkPromoteAsk();
    await new Promise((r) => setTimeout(r, 200));
    const m = document.getElementById('rb-del-modal');
    const text = (m?.textContent || '').replace(/\s+/g, ' ');
    const suggested = m?.querySelector('#rb-lknew-name')?.value;
    const quiet = Array.from(m?.querySelectorAll('button') || []).map((x) => x.textContent);
    const inp = m?.querySelector('#rb-lknew-name');
    if (inp) inp.value = 'The Thursday one, in the basket';
    m?.querySelector('#rb-lknew-yes')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      text: text.slice(0, 140), suggested, quiet,
      title: ((e) => e ? (e.tagName === 'INPUT' ? e.value : e.textContent) : null)(document.getElementById('rb-lk-title')),
      wears: document.querySelectorAll('.rb-lk-stat')[0]?.querySelector('b')?.textContent,
      note: document.querySelector('.rb-lk-panel .pl')?.textContent,
    };
  });
  check('promotion · the D2 modal asks with a name ready, and the quiet way is update',
    /You changed one piece/.test(promoted.text) && /Save it as a new look\?/.test(promoted.text)
      && !!promoted.suggested && promoted.quiet.includes('Just update this look'),
    JSON.stringify([promoted.text, promoted.suggested, promoted.quiet]));
  check('promotion · Save as a new look opens the NEW look under her name',
    promoted.title === 'The Thursday one, in the basket', promoted.title);
  check('promotion · the new look starts with no wears', promoted.wears === '0', String(promoted.wears));
  check('promotion · says the original is untouched', /untouched/.test(promoted.note || ''), promoted.note);
  await page.waitForTimeout(500);
  const newLook = writes.find((w) => w.method === 'POST' && /^looks/.test(w.url));
  check('promotion · writes a new look row carrying its origin',
    !!newLook && newLook.body?.origin_look_id === 'lk-1' && newLook.body?.source === 'variant'
      && newLook.body?.name === 'The Thursday one, in the basket' && newLook.body?.name_provisional === false,
    JSON.stringify(newLook?.body || null));
  check('promotion · never rewrote the ancestor composition',
    !writes.some((w) => w.method === 'DELETE' && /look_pieces\?look_id=eq\.lk-1/.test(w.url)),
    JSON.stringify(writes.filter((w) => /look_pieces/.test(w.url)).map((w) => w.method + ' ' + w.url)));

  // Update-this-look keeps identity and history
  const upd = await page.evaluate(() => {
    window.__lkOpen('lk-1');
    window.__lkEditToggle();
    window.__lkDSwapApply(2, 'w-sho2');
    window.__lkResave();
    return {
      note: document.querySelector('.rb-lk-panel .pl')?.textContent,
      wears: document.querySelectorAll('.rb-lk-stat')[0]?.querySelector('b')?.textContent,
      pieces: Array.from(document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-name')).map((n) => n.textContent),
      firstWearSnapshot: document.querySelector('.rb-lk-wear .pc')?.textContent,
      barGone: !document.querySelector('.rb-lk-editbar'),
    };
  });
  check('update · keeps the look and states history is intact',
    /2 wears stay as they were/.test(upd.note || '') && upd.barGone === true, upd.note);
  check('update · wear count survives the edit', upd.wears === '2', String(upd.wears));
  check('update · composition changed', upd.pieces.includes('Tan leather slides'), JSON.stringify(upd.pieces));
  check('update · the wear keeps its own snapshot (history never rewritten)',
    /Flat leather sandals/.test(upd.firstWearSnapshot || ''), upd.firstWearSnapshot);

  // A flick lands live too, and Discard puts the look back as saved.
  const flickLive = await page.evaluate(() => {
    window.__lkEditToggle();
    const names = () => Array.from(document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-name')).map((n) => n.textContent);
    window.__lkDFlip(2, 1);
    const after = names();
    const bar = !!document.querySelector('.rb-lk-editbar');
    window.__lkDraftDiscard();
    const restored = names();
    const barGone = !document.querySelector('.rb-lk-editbar');
    return { after, bar, restored, barGone };
  });
  check('flick · lands live on the view, with the strip standing',
    !flickLive.after.includes('Tan leather slides') && flickLive.bar === true, JSON.stringify(flickLive.after));
  check('flick · Discard puts the look back exactly as saved',
    flickLive.restored.includes('Tan leather slides') && flickLive.barGone === true,
    JSON.stringify(flickLive.restored));

  // Wear on a day (the pin mechanics, in the wear vocabulary)
  const pinned = await page.evaluate(() => {
    window.__lkAct('pin');
    const btns = Array.from(document.querySelectorAll('.rb-lk-panel-acts .rb-lk-act')).map((b) => b.textContent);
    document.querySelectorAll('.rb-lk-panel-acts .rb-lk-act')[1].click();  // Tomorrow
    const strip = document.querySelector('.rb-lk-pinstrip');
    return {
      btns,
      strip: (strip?.textContent || '').replace(/\s+/g, ' '),
      door: strip?.querySelector('button')?.textContent,
    };
  });
  check('pin · offers today, tomorrow and a date', pinned.btns.length >= 3, JSON.stringify(pinned.btns));
  // The reminder STRIP appearing is the confirmation (C1) — no second panel.
  check('pin · the reminder strip names the day and opens it',
    /^Pinned for [A-Z][a-z]+day \d+ [A-Z]/.test(pinned.strip) && pinned.door === 'Open the day →',
    JSON.stringify([pinned.strip, pinned.door]));
  await page.waitForTimeout(1200);   // the planned_days write is debounced
  const pinWrite = writes.find((w) => w.method === 'POST' && /^planned_days/.test(w.url));
  check('pin · writes a planned_days row of source_type look',
    !!pinWrite && Array.isArray(pinWrite.body) && pinWrite.body[0]?.source_type === 'look' && pinWrite.body[0]?.source_id === 'lk-1',
    JSON.stringify(pinWrite?.body?.[0] || null));
  check('pin · the day carries the look\'s pieces', (pinWrite?.body?.[0]?.item_ids || []).length === 4,
    JSON.stringify(pinWrite?.body?.[0]?.item_ids || null));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 5 · The composer (Phase 2) — the live console: Look panel left at 480px,
// rack rows with flick / swap / ✕ right, Save live from the first second
// (the name is the one gate); her model stands on the canvas and the rack
// dresses her (2026-09-03)
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, writes } = await boot(browser, { avatar: 'w-s5-h2-hg' });
  // Her cell answers at once; each render is a job that lands one frame,
  // named for the pieces it was asked for.
  const renders = [];
  await page.route('**/api/avatar/cell', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://img.test/cell.jpg' }) }));
  await page.route('**/api/avatar/render', (r) => {
    const b = r.request().postDataJSON();
    renders.push(b.pieces.map((p) => p.name));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'rj' + renders.length }) });
  });
  await page.route('**/api/images/rj*', (r) => {
    const n = r.request().url().split('/rj')[1];
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: ['https://img.test/render-' + n + '.jpg'], done: true }) });
  });
  await page.route('**img.test/**', (r) => r.abort());
  await openLooks(page);
  await page.evaluate(() => window.__lkNew());
  await page.waitForTimeout(300);

  const c0 = await page.evaluate(() => {
    const empties = Array.from(document.querySelectorAll('.rbc-row.rb-lk-rempty'));
    const con = document.querySelector('.rb-lk-con');
    return {
      lookv2: document.body.classList.contains('rb-lookv2'),
      cols: con ? getComputedStyle(con).gridTemplateColumns : '',
      emptyRows: empties.length,
      ghostAdds: document.querySelectorAll('.rb-lk-con .rbc-rghost .rbc-act').length,
      panel: !!document.querySelector('.rb-lk-con .rbc-panel'),
      saveShown: !!document.querySelector('.rb-lk-save'),
      saveDisabled: document.querySelector('.rb-lk-save')?.disabled,
      saveUnnamed: document.querySelector('.rb-lk-save')?.classList.contains('unnamed'),
      saveNote: document.getElementById('rb-lk-namegate')?.textContent,
      // The model on the canvas (2026-09-03): her photograph, in the base
      // layer, from the first second
      stage: !!document.querySelector('.rb-lk-con .rb-lkm-stage'),
      img: document.querySelector('.rb-lk-con .rb-lkm-img')?.getAttribute('src'),
      busy: !!document.querySelector('.rb-lk-con .rb-lkm-busy'),
      photoDoor: document.querySelector('.rb-lk-con .rb-lkm-addphoto')?.textContent.trim(),
      photoNote: document.querySelector('.rb-lk-con .rb-lkm-note')?.textContent,
      // The composer is one held card, with the name leading it from
      // outside (FTUE pass 2026-08-12)
      card: !!document.querySelector('.rb-lk-composer > .rb-lk-con'),
      titleOutside: !!document.querySelector('.rb-lk-newmast #rb-lk-newtitle')
        && !document.querySelector('.rb-lk-composer #rb-lk-newtitle'),
      rackEyebrow: document.querySelector('.rbc-rackhead .ey')?.textContent,
      robesDoor: document.querySelector('.rb-lk-robesdoor')?.textContent,
      titleValue: document.getElementById('rb-lk-newtitle')?.value,
      titlePlaceholder: document.getElementById('rb-lk-newtitle')?.placeholder,
      namedByYou: /Named by you/.test(document.body.textContent || ''),
      addPiece: !!document.querySelector('.rbc-addpiece'),
    };
  });
  check('composer · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  // A fresh session has rendered no console — the composer must inject the
  // shared stylesheet itself, and the styles must actually apply.
  const css = await page.evaluate(() => {
    // The empty composer holds no rows any more — the strips are the
    // styled markup to probe.
    const strip = document.querySelector('.rbc-rolestrip');
    const ey = strip?.querySelector('span');
    return {
      sheet: !!document.getElementById('rbc-style'),
      stripIsFlex: strip ? getComputedStyle(strip).display === 'flex' : false,
      eyCaps: ey ? getComputedStyle(ey).textTransform === 'uppercase' : false,
    };
  });
  check('composer · shared console stylesheet is injected without a console render',
    css.sheet && css.stripIsFlex && css.eyCaps, JSON.stringify(css));
  check('composer · the standing console scale: 480px look column',
    /^480px/.test(c0.cols) && c0.lookv2, c0.cols + ' lookv2=' + c0.lookv2);
  check('composer · the look panel is the shared rbc-panel', c0.panel === true);
  // A2/B1 amendments (2026-08-07): NO slot-bound empty rows — a slot must
  // never forecast a role. The rack IS the formula: each awaiting role is
  // a dashed definition row with its own + Add. The trailing generic CTA
  // ALWAYS closes the rack (regression fixed 2026-08-12 — it used to wait
  // until all four roles were inked, taking the door away from the empty
  // look that most needs it).
  check('composer · no slot-bound empty rows; four role rows carry the way in',
    c0.emptyRows === 0 && c0.ghostAdds === 4, JSON.stringify([c0.emptyRows, c0.ghostAdds]));
  check('composer · the generic + Add a piece always closes the rack', c0.addPiece === true);
  // The whole dashed row is the hit area, not just the pill (~52px)
  const hit = await page.evaluate(() => {
    const row = document.querySelector('.rb-lk-con .rbc-rghost');
    const r = row?.getBoundingClientRect();
    // Tap the ROW's own padding, well clear of the pill
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const opened = !!document.getElementById('rb-lkadd-sheet');
    window.__lkAddClose && window.__lkAddClose();
    return { h: r ? Math.round(r.height) : 0, tap: row?.classList.contains('tap'), opened };
  });
  check('composer · the whole slot row is the tap target, 52px+',
    hit.tap === true && hit.h >= 52 && hit.opened === true, JSON.stringify(hit));
  // Save stands on screen and LIVE from the first second — the name is
  // the one gate (2026-09-03; the two-piece floor is gone). The pill reads
  // cream until the look is named, and the note beside it says why.
  check('composer · Save stands on screen, live, cream until the look is named',
    c0.saveShown === true && c0.saveDisabled === false && c0.saveUnnamed === true
      && c0.saveNote === 'Name your look and it is yours to keep.',
    JSON.stringify([c0.saveShown, c0.saveDisabled, c0.saveUnnamed, c0.saveNote]));
  check('composer · the whole composer sits in ONE card, the name leading it from outside',
    c0.card === true && c0.titleOutside === true, JSON.stringify([c0.card, c0.titleOutside]));
  // The "Or let Robes create your look" door is gone (2026-09-03) — the
  // home prompt box is where Robes builds.
  check('composer · no "Or let Robes create your look" door beside Save',
    c0.robesDoor === undefined, String(c0.robesDoor));
  // Her REAL model stands on the canvas from the first second — the
  // avatar cell (her in the base layer), no sketch, nothing still coming.
  check('composer · her photographed model stands on the canvas from the first second',
    c0.stage === true && c0.img === 'https://img.test/cell.jpg' && c0.busy === false,
    JSON.stringify([c0.stage, c0.img, c0.busy]));
  check('composer · the photograph door sits under the canvas',
    c0.photoDoor === 'Add your photograph' && /Add your photograph and it is kept alongside her/.test(c0.photoNote || ''),
    JSON.stringify([c0.photoDoor, c0.photoNote]));
  // B1 amendment (2026-08-07): the empty state teaches the formula — every
  // empty row sits under a GHOSTED strip forecast from its slot. Education
  // only: the forecast never binds what she adds where.
  const ghosts = await page.evaluate(() => {
    const strips = Array.from(document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-rolestrip'));
    const notes = Array.from(document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-rolenote')).map((n) => n.textContent);
    return {
      labels: strips.map((s) => s.textContent.trim()),
      allGhost: strips.length > 0 && strips.every((s) => s.classList.contains('ghost')),
      notes,
    };
  });
  check('composer · empty rows sit under ghosted formula strips',
    JSON.stringify(ghosts.labels) === JSON.stringify(['The Canvas', 'The Anchor', 'The Texture', 'The Exclamation Point'])
      && ghosts.allGhost, JSON.stringify(ghosts.labels));
  check('composer · each awaiting role carries its education line',
    ghosts.notes.length === 4
      && /Elevated basics balancing proportion and tone/.test(ghosts.notes[0])
      && /hero piece setting the look/.test(ghosts.notes[1])
      && /tactile layer/.test(ghosts.notes[2])
      && /signature finish/.test(ghosts.notes[3]),
    JSON.stringify(ghosts.notes));
  // No second header above the strips — the formula strips name themselves
  // and the masthead names the look (FTUE pass 2026-08-12).
  check('composer · no rack header above the formula strips', c0.rackEyebrow === undefined, c0.rackEyebrow);
  check('composer · the name field is a placeholder, "Name your Look"',
    c0.titleValue === '' && c0.titlePlaceholder === 'Name your Look',
    JSON.stringify([c0.titleValue, c0.titlePlaceholder]));
  check('composer · no "Named by you" subtext', c0.namedByYou === false);
  // The canvas keeps the standing 4:5 frame (the model's stage), never a
  // tower past the rack.
  const panelH = await page.evaluate(() => {
    const c = document.querySelector('.rb-lk-con .rb-lkm-canvas');
    const r = c?.getBoundingClientRect();
    return r ? { ratio: Math.round((r.height / r.width) * 100) / 100 } : null;
  });
  check('composer · the canvas is the standing 4:5 frame',
    !!panelH && Math.abs(panelH.ratio - 1.25) <= 0.02, JSON.stringify(panelH));

  // "+ Add a piece" opens the A2 chooser: What kind of piece? An EMPTY
  // look goes straight to all fifteen categories — no still-open gate.
  const chooser = await page.evaluate(() => {
    window.__lkAddOpen();
    const sheet = document.getElementById('rb-lkadd-sheet');
    return {
      open: !!sheet,
      head: /What kind of piece\?/.test(sheet?.textContent || ''),
      stillOpen: /Still open in this look/i.test(sheet?.textContent || ''),
      cats: sheet ? sheet.querySelectorAll('[data-lkadd-cat]').length : 0,
    };
  });
  check('composer · + Add a piece opens the A2 chooser', chooser.open && chooser.head, JSON.stringify(chooser));
  check('composer · an empty look offers all fifteen categories, no still-open gate',
    chooser.stillOpen === false && chooser.cats === 15, JSON.stringify(chooser));

  // A category opens the wardrobe picker (sheet-level filter) + Snap
  const pick = await page.evaluate(() => {
    document.querySelector('[data-lkadd-cat="Tops"]').click();
    const sheet = document.getElementById('rb-lkadd-sheet');
    const opts = Array.from(sheet?.querySelectorAll('.rb-lk-opt span') || []).map((s) => s.textContent);
    return {
      step2: /From your wardrobe\./.test(sheet?.textContent || ''),
      snap: /Snap a new piece/.test(sheet?.textContent || ''),
      caption: /files it to your wardrobe, then into the look/.test(sheet?.textContent || ''),
      opts,
    };
  });
  check('composer · a category opens the wardrobe picker with Snap a new piece',
    pick.step2 && pick.snap && pick.caption, JSON.stringify(pick));
  check('composer · the picker is category-filtered (Tops shows tops only)',
    pick.opts.includes('Cream silk shirt') && !pick.opts.includes('Bias slip dress') && !pick.opts.includes('Linen shorts'),
    JSON.stringify(pick.opts));

  const one = await page.evaluate(() => {
    const opt = Array.from(document.querySelectorAll('#rb-lkadd-sheet .rb-lk-opt'))
      .find((b) => b.querySelector('span')?.textContent === 'Cream silk shirt');
    opt.click();
    const sheetGone = !document.getElementById('rb-lkadd-sheet');
    const row = document.querySelector('.rbc-row:not(.rb-lk-rempty)');
    // Once the look holds a piece, the chooser leads with Still open
    window.__lkAddOpen();
    const reopened = document.getElementById('rb-lkadd-sheet');
    const stillOpen = /Still open in this look/i.test(reopened?.textContent || '');
    const stillChips = Array.from(reopened?.querySelectorAll('button[onclick*="__lkAddPickSlot"]') || []).map((b) => b.textContent);
    window.__lkAddClose();
    window.__rbLkSheetGone = sheetGone;
    window.__rbLkStill = { stillOpen, stillChips };
    return {
      name: row?.querySelector('.rbc-name')?.textContent,
      owned: /In your wardrobe/.test(row?.querySelector('.rbc-sub')?.textContent || ''),
      flick: row?.querySelectorAll('.rbc-arrow').length,
      swap: !!Array.from(row?.querySelectorAll('.rbc-act') || []).find((b) => /Swap/.test(b.textContent)),
      x: !!row?.querySelector('.rbc-rm'),
      img: document.querySelector('.rb-lk-con .rb-lkm-img')?.getAttribute('src'),
      busy: document.querySelector('.rb-lk-con .rb-lkm-busy')?.textContent,
      saveDisabled: document.querySelector('.rb-lk-save')?.disabled,
      saveUnnamed: document.querySelector('.rb-lk-save')?.classList.contains('unnamed'),
      roleNotes: document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-rolenote').length,
    };
  });
  // The pick asks for a render after a beat of quiet; the cell stays up,
  // with the chip, until the frame lands — then she wears the piece.
  await page.waitForTimeout(2600);
  const oneLanded = await page.evaluate(() => ({
    img: document.querySelector('.rb-lk-con .rb-lkm-img')?.getAttribute('src'),
    busy: !!document.querySelector('.rb-lk-con .rb-lkm-busy'),
    caret: document.activeElement?.id,
  }));
  check('composer · a filled row is the shared rack card',
    one.name === 'Cream silk shirt' && one.owned === true, `${one.name}/${one.owned}`);
  check('composer · the education line gives way once its role is cast',
    one.roleNotes === 3, String(one.roleNotes));
  check('composer · the card carries the flick cluster', one.flick === 2, String(one.flick));
  check('composer · the card carries Swap', one.swap === true);
  check('composer · the card carries the corner ✕', one.x === true);
  check('composer · a pick keeps her photograph up and says the next one is coming',
    one.img === 'https://img.test/cell.jpg' && one.busy === 'Dressing her…', JSON.stringify([one.img, one.busy]));
  check('composer · one render per settled composition, for the piece on the rack',
    JSON.stringify(renders) === JSON.stringify([['Cream silk shirt']]) && oneLanded.img === 'https://img.test/render-1.jpg' && oneLanded.busy === false,
    JSON.stringify([renders, oneLanded]));
  check('composer · one piece: Save is live, still cream until named',
    one.saveDisabled === false && one.saveUnnamed === true, JSON.stringify([one.saveDisabled, one.saveUnnamed]));
  const still = await page.evaluate(() => ({ gone: window.__rbLkSheetGone, ...window.__rbLkStill }));
  check('composer · picking a piece closes the sheet into the rack', still.gone === true);
  check('composer · with a piece placed, Still-open leads the chooser',
    still.stillOpen === true && JSON.stringify(still.stillChips) === JSON.stringify(['Bottom', 'Shoe', 'Bag']),
    JSON.stringify(still));
  // The strip inks in as the role is cast (B1), and a drag re-casts freely
  const inked = await page.evaluate(() => {
    const stripOf = (label) => Array.from(document.querySelectorAll('.rb-lk-con .rbc-rack .rbc-rolestrip'))
      .find((s) => s.textContent.trim() === label);
    const before = { canvas: stripOf('The Canvas')?.classList.contains('ghost') };
    window.__lkCRoleDrop(0, 'The Anchor');
    const after = {
      canvasGhost: stripOf('The Canvas')?.classList.contains('ghost'),
      anchorGhost: stripOf('The Anchor')?.classList.contains('ghost'),
    };
    window.__lkCRoleDrop(0, 'The Canvas');
    return { beforeCanvasGhost: before.canvas, ...after };
  });
  check('composer · a landed piece inks its strip; a drag re-casts it freely',
    inked.beforeCanvasGhost === false && inked.canvasGhost === true && inked.anchorGhost === false,
    JSON.stringify(inked));

  // The flick cycles same-category pieces
  const flicked = await page.evaluate(() => {
    window.__lkCFlip(0, 1);
    return { name: document.querySelector('.rbc-row:not(.rb-lk-rempty) .rbc-name')?.textContent };
  });
  check('composer · flick moves to the next piece of that kind',
    flicked.name === 'Ribbed white tank' || flicked.name === 'Bias slip dress', flicked.name);
  await page.evaluate(() => window.__lkRowPick('r1', 'w-top1'));

  // Swap opens the SAME modal the consoles use
  const swap = await page.evaluate(() => {
    window.__lkCSwap(0);
    const modal = document.getElementById('lk-swap-modal');
    return {
      open: !!modal,
      head: modal?.querySelector('p')?.textContent,
      wardrobe: /From your wardrobe/.test(modal?.textContent || ''),
      snap: /Snap mine/.test(modal?.textContent || ''),
    };
  });
  check('composer · Swap opens the shared swap modal', swap.open === true);
  check('composer · the modal offers her wardrobe and Snap mine',
    swap.wardrobe === true && swap.snap === true, JSON.stringify(swap));
  const swapped = await page.evaluate(() => {
    window.__lkCSwapApply(0, 'w-top2');
    return {
      modalGone: !document.getElementById('lk-swap-modal'),
      name: document.querySelector('.rbc-row:not(.rb-lk-rempty) .rbc-name')?.textContent,
    };
  });
  check('composer · the swap applies and closes the modal',
    swapped.modalGone && swapped.name === 'Ribbed white tank', JSON.stringify(swapped));

  // ✕ removes the row; the slot returns to the chooser's Still-open list
  // (no placeholder rows since the A2 amendment — slots never sit in the
  // rack empty, and never forecast a role)
  const xed = await page.evaluate(() => {
    document.querySelector('.rbc-row:not(.rb-lk-rempty) .rbc-rm').click();
    window.__lkAddOpen();
    const sheet = document.getElementById('rb-lkadd-sheet');
    const stillOpen = /Still open in this look/i.test(sheet?.textContent || '');
    window.__lkAddClose();
    return {
      empties: document.querySelectorAll('.rbc-row.rb-lk-rempty').length,
      filled: document.querySelectorAll('.rbc-row:not(.rb-lk-rempty):not(.rbc-rghost)').length,
      stillOpen,
    };
  });
  check('composer · ✕ removes the row; the slot returns to the chooser, never a bound placeholder',
    xed.empties === 0 && xed.filled === 0 && xed.stillOpen === false, JSON.stringify(xed));

  // A role row's + Add pre-casts that role on the pick — a TOP added
  // through The Anchor's row anchors (nothing dictates what goes where).
  const armed = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.rb-lk-con .rbc-rghost'))
      .find((r) => r.previousElementSibling?.textContent.trim() === 'The Anchor');
    row.querySelector('.rbc-act').click();
    const eyebrow = document.querySelector('#rb-lkadd-sheet p')?.textContent || '';
    document.querySelector('[data-lkadd-cat="Tops"]').click();
    Array.from(document.querySelectorAll('#rb-lkadd-sheet .rb-lk-opt'))
      .find((b) => b.querySelector('span')?.textContent === 'Cream silk shirt').click();
    const rack = document.querySelector('.rb-lk-con .rbc-rack');
    const names = [];
    let inGroup = false;
    Array.from(rack.children).forEach((el) => {
      if (el.classList.contains('rbc-rolestrip')) inGroup = el.textContent.trim() === 'The Anchor';
      else if (inGroup && !el.classList.contains('rbc-rghost')) {
        const n = el.querySelector('.rbc-name');
        if (n) names.push(n.textContent);
      }
    });
    window.__lkNew();   // reset roles + rows for the sections below
    return { eyebrow, names };
  });
  check('composer · a role row\'s + Add pre-casts the role — a top can anchor',
    /The Anchor/.test(armed.eyebrow) && armed.names.includes('Cream silk shirt'), JSON.stringify(armed));

  const two = await page.evaluate(() => {
    window.__lkRowPick('r1', 'w-top1');
    window.__lkRowPick('r2', 'w-bot1');
    const out = {
      saveShown: !!document.querySelector('.rb-lk-save'),
      saveDisabled: document.querySelector('.rb-lk-save')?.disabled,
      gate: !!document.getElementById('rb-lk-namegate'),
      img: document.querySelector('.rb-lk-con .rb-lkm-img')?.getAttribute('src'),
      head: document.querySelector('.rb-lk-con .rb-lkm-panel .lab')?.textContent,
    };
    // Typing flips the button in place — a repaint here would take the
    // caret out of the field she is typing into.
    window.__lkNewTitleInput('Terrace mornings');
    out.namedLive = document.querySelector('.rb-lk-save')?.disabled === false
      && !document.querySelector('.rb-lk-save')?.classList.contains('unnamed');
    out.namedNote = document.getElementById('rb-lk-namegate')?.textContent;
    window.__lkNewTitleInput('');
    out.unnamedAgain = document.querySelector('.rb-lk-save')?.classList.contains('unnamed');
    return out;
  });
  // RULE 02 — pieces are not enough. The name is still the gate, but it
  // answers at the CLICK (2026-08-20): Save is live, an unnamed save
  // refuses out loud (focus + toast) and writes nothing.
  check('composer · two pieces are not enough — the name gates at the click',
    two.saveShown === true && two.saveDisabled === false && two.gate === true,
    JSON.stringify([two.saveShown, two.saveDisabled, two.gate]));
  check('composer · naming it inks Save in place, without losing the caret',
    two.namedLive === true && two.namedNote === 'Filed under Terrace mornings.' && two.unnamedAgain === true,
    JSON.stringify([two.namedLive, two.namedNote, two.unnamedAgain]));
  const refusal = await page.evaluate(async () => {
    window.__lkSaveAsk();
    await new Promise((r) => setTimeout(r, 400));
    return {
      stillComposing: !!document.getElementById('rb-lk-newtitle'),
      looksCount: (window.__TEST_LOOKS_WRITES || 0),
    };
  });
  check('composer · an unnamed save writes nothing and stays on the composer',
    refusal.stillComposing === true, JSON.stringify(refusal));
  // Two picks in one beat → ONE render, for both pieces; the last frame
  // stayed up meanwhile.
  await page.waitForTimeout(2600);
  const twoLanded = await page.evaluate(() => ({
    img: document.querySelector('.rb-lk-con .rb-lkm-img')?.getAttribute('src'),
    busy: !!document.querySelector('.rb-lk-con .rb-lkm-busy'),
  }));
  check('composer · two picks in one beat ask for one render, both pieces on it',
    two.img === 'https://img.test/render-1.jpg' && renders.length === 2
      && JSON.stringify(renders[1].slice().sort()) === JSON.stringify(['Barrel-leg jeans', 'Cream silk shirt'])
      && twoLanded.img === 'https://img.test/render-2.jpg' && twoLanded.busy === false,
    JSON.stringify([two.img, renders, twoLanded]));
  check('composer · the canvas eyebrow counts what she has on', two.head === 'The look · 2 pieces', two.head);

  // A dress in the Top slot retires the Bottom row — and on the canvas a
  // dress replaces both basics (top and bottom) in one shape
  const dress = await page.evaluate(() => {
    window.__lkRowClear('r2');
    window.__lkRowPick('r1', 'w-dre1');
    return { slots: Array.from(document.querySelectorAll('.rbc-row .vslot')).map((b) => b.textContent) };
  });
  check('composer · a dress quietly retires the Bottom slot',
    !dress.slots.includes('Bottom'), JSON.stringify(dress.slots));

  // "+ Add a piece" routes through the shared chooser and its apply lands
  const added = await page.evaluate(() => {
    window.__lkRowPick('r1', 'w-top1');
    window.__lkRowPick('r3', 'w-sho1');
    window.__lkApplyNew('w-acc1');
    return {
      names: Array.from(document.querySelectorAll('.rbc-row:not(.rb-lk-rempty) .rbc-name')).map((n) => n.textContent),
      head: document.querySelector('.rb-lk-con .rb-lkm-panel .lab')?.textContent,
    };
  });
  check('composer · an added piece lands as its own rack card',
    added.names.includes('Gold hoops'), JSON.stringify(added.names));
  check('composer · pieces are never double-counted',
    added.head === 'The look · 3 pieces', added.head);

  await page.evaluate(() => { window.__lkRowPick('r4', 'w-bag1'); });
  await page.waitForTimeout(2600);
  const beforeSave = renders.length;
  const saved = await page.evaluate(() => {
    window.__lkNewTitleInput('Terrace mornings');
    window.__lkSave();
    return {
      gridShown: document.getElementById('rb-lk-grid')?.style.display !== 'none',
      titles: Array.from(document.querySelectorAll('#rb-lk-grid .lt-title')).map((t) => t.textContent),
      toast: (document.getElementById('toast-msg') || document.getElementById('toast'))?.textContent,
    };
  });
  check('composer · save lands back on the grid, no interstitial',
    saved.gridShown && saved.titles.includes('Terrace mornings'), JSON.stringify([saved.gridShown, saved.titles]));
  check('composer · the confirmation is a quiet toast',
    /Terrace mornings saved to Looks/.test(saved.toast || ''), saved.toast);
  check('composer · the grid grows', saved.titles.length === 3, JSON.stringify(saved.titles));
  await page.waitForTimeout(600);
  const lookWrite = writes.filter((w) => w.method === 'POST' && /^looks/.test(w.url)).pop();
  const pieceWrite = writes.filter((w) => w.method === 'POST' && /^look_pieces/.test(w.url)).pop();
  check('composer · writes the look with her name, not provisional',
    !!lookWrite && lookWrite.body?.name === 'Terrace mornings' && lookWrite.body?.name_provisional === false && lookWrite.body?.source === 'manual',
    JSON.stringify(lookWrite?.body || null));
  // The photograph already on the canvas IS the saved look's render — the
  // row carries it under the same key, and Save asks for no second frame.
  const renderWrite = writes.filter((w) => w.method === 'PATCH' && /^looks\?id=eq\./.test(w.url) && w.body?.render_url).pop();
  check('composer · Save reuses the canvas render — no second render',
    !!renderWrite && renderWrite.body.render_url === 'https://img.test/render-' + beforeSave + '.jpg'
      && /^w-s5-h2-hg\|/.test(renderWrite.body.render_key || '') && renders.length === beforeSave,
    JSON.stringify([renderWrite?.body?.render_url, renderWrite?.body?.render_key, beforeSave, renders.length]));
  // the hoops landed in the Bag slot (first empty slot taking Accessories)
  // and the test then swapped the tote in over them — 3 pieces at save
  check('composer · writes its composition with slots',
    Array.isArray(pieceWrite?.body) && pieceWrite.body.length === 3 && pieceWrite.body.every((p) => !!p.slot),
    JSON.stringify(pieceWrite?.body || null));
  check('composer · a saved look has no wears (it is a plan, not a fact)',
    !writes.some((w) => w.method === 'POST' && /^wears/.test(w.url)));

  // An unnamed look never reaches the grid (rule 02): Save declines and
  // puts the caret where the answer goes.
  const offered = await page.evaluate(() => {
    window.__lkNew();
    window.__lkRowPick('r1', 'w-top2');
    window.__lkRowPick('r2', 'w-bot2');
    const start = document.querySelectorAll('#rb-lk-grid .lt-title').length;
    window.__lkSave();
    const before = document.querySelectorAll('#rb-lk-grid .lt-title').length;
    const grew = before > start;
    const focused = document.activeElement && document.activeElement.id;
    window.__lkNewTitleInput('The tank one');
    window.__lkSave();
    const tile = Array.from(document.querySelectorAll('#rb-lk-grid .lt-title')).find((t) => t.textContent === 'The tank one');
    return { grew, focused, onGrid: !!tile, prov: tile ? tile.classList.contains('prov') : null };
  });
  check('composer · an unnamed look does not save — it asks for the name',
    offered.grew === false && offered.focused === 'rb-lk-newtitle', JSON.stringify(offered));
  check('composer · named, it lands on the grid as HER name, not a provisional one',
    offered.onGrid === true && offered.prov === false, JSON.stringify(offered));
  await page.waitForTimeout(400);
  const provWrite = writes.filter((w) => w.method === 'POST' && /^looks/.test(w.url)).pop();
  check('composer · and the name she typed is what persists',
    provWrite?.body?.name === 'The tank one' && provWrite?.body?.name_provisional === false,
    JSON.stringify(provWrite?.body || null));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 5b · An empty category never dead-ends — the normal add flow from a slot
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs } = await boot(browser, { dropCat: 'Shoes', seed: false });
  await openLooks(page);
  await page.evaluate(() => window.__lkNew());
  await page.waitForTimeout(300);

  const shoe = await page.evaluate(() => {
    window.__lkAddOpen();
    document.querySelector('[data-lkadd-cat="Shoes"]').click();
    const sheet = document.getElementById('rb-lkadd-sheet');
    return {
      deadEnd: /Nothing else in that category yet/.test(sheet?.textContent || ''),
      invite: /Nothing filed under Shoes yet/.test(sheet?.textContent || ''),
      snapBtn: !!Array.from(sheet?.querySelectorAll('button') || []).find((b) => /Snap a new piece/.test(b.textContent)),
    };
  });
  check('no-shoes · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  check('no-shoes · the empty category invites instead of dead-ending',
    !shoe.deadEnd && shoe.invite, JSON.stringify(shoe));
  check('no-shoes · and offers the normal add flow', shoe.snapBtn === true);

  const wa = await page.evaluate(() => {
    window.__lkAddSnap();
    return new Promise((res) => setTimeout(() => {
      const m = document.getElementById('wa-modal');
      res({ open: !!m && m.classList.contains('open') });
    }, 600));
  });
  check('no-shoes · Snap opens the standard wardrobe add modal', wa.open === true, JSON.stringify(wa));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 5b · "Let Robes build the first one" — the SAME rack, filled, saving
// nothing until she does. One shop suggestion when her wardrobe nearly
// covers it (04b); real shoppable proposals when it doesn't (04c).
// ─────────────────────────────────────────────────────────────────────────
const ALTS = {
  alternates: [
    { name: 'Cropped Bouclé Jacket', brand: 'Sézane', retailer_hint: 'Sezane.com', price_point: '€250', how: 'Worn open, sleeves pushed to the forearm.' },
    { name: 'Wide Wool Trouser', brand: 'Toteme', retailer_hint: 'Net-a-Porter', price_point: '€390', how: 'Hem breaking just over the shoe.' },
  ],
};
// The build's stylist words (2026-08-13): /api/lookbuild/note writes the
// panel note, the colour story and the filing AFTER the pieces settle.
const BUILD_NOTE = {
  note: 'Soft tailoring against denim; the jacket does the finishing.',
  palette: ['#E7E0CF', '#3B3F52'],
  look_tags: { climate: 'year_round', wear_for: ['work'], vibe: ['soft'] },
};
const routeBuildNote = (page) => page.route('**/api/lookbuild/note', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BUILD_NOTE) }));
{
  // pics:6 covers Canvas / Anchor / Exclamation; the fixture has no
  // Outerwear, so Texture is the one gap → the owned build.
  const { ctx, page, errs, writes } = await boot(browser, { seed: false, pics: 6 });
  await page.route('**/api/alternates', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALTS) }));
  await routeBuildNote(page);
  await page.route('**res.cloudinary.com/**', (r) => r.abort());
  await openLooks(page);
  await page.waitForTimeout(300);

  // In place, no new screen: flat cream blocks, no spinner, no navigation
  const during = await page.evaluate(async () => {
    const before = location.pathname;
    window.__lkRobesBuild();
    await new Promise((r) => setTimeout(r, 250));
    return {
      fill: !!document.querySelector('.rb-lk-fill'),
      spinner: !!document.querySelector('.rb-spin, #kp-loading-overlay[style*="flex"]'),
      moved: location.pathname !== before,
      composerStill: !!document.querySelector('.rb-lk-composer'),
      titleEmpty: document.getElementById('rb-lk-newtitle')?.value === '',
    };
  });
  check('build · fills in place — cream blocks, no spinner, no navigation',
    during.fill === true && during.spinner === false && during.moved === false
      && during.composerStill === true, JSON.stringify(during));
  check('build · the name has not landed yet', during.titleEmpty === true, JSON.stringify(during));

  await page.waitForTimeout(2600);
  const b = await page.evaluate(() => ({
    head: document.querySelector('.rbc-lhead .lab')?.textContent,
    robes: document.querySelector('.rbc-lhead .robes')?.textContent,
    rows: Array.from(document.querySelectorAll('.rbc-rack .rbc-row:not(.rb-lk-prop) .rbc-name')).map((n) => n.textContent),
    shop: Array.from(document.querySelectorAll('.rb-lk-prop .rbc-name')).map((n) => n.textContent),
    shopActs: Array.from(document.querySelectorAll('.rb-lk-prop .rbc-act')).map((b2) => b2.textContent.trim()),
    flicks: document.querySelectorAll('.rbc-rack .rbc-arrow').length,
    removes: document.querySelectorAll('.rbc-rack .rbc-rm').length,
    title: document.getElementById('rb-lk-newtitle')?.value,
    note: document.querySelector('.rb-lk-namenote')?.textContent,
    foot: Array.from(document.querySelectorAll('.rb-lk-buildfoot button')).map((x) => x.textContent),
    saveDisabled: document.querySelector('.rb-lk-save')?.disabled,
    photo: Array.from(document.querySelectorAll('.rb-lk-quiet')).map((x) => x.textContent)[0],
    quote: document.querySelector('.rbc-quote')?.textContent,
    tags: Array.from(document.querySelectorAll('.rbc-tags .tg')).map((t) => t.textContent),
    fabrics: document.querySelectorAll('.rbc-fabrics .fab').length,
    slotEye: document.querySelector('.rb-lk-prop .vslot')?.textContent,
    hownote: document.querySelector('.rb-lk-prop .rbc-hownote')?.textContent,
    swapIcon: !!document.querySelector('.rb-lk-prop .rbc-acts button svg'),
    saveCls: !!document.querySelector('.rb-lk-prop .rbc-act.save'),
  }));
  check('build · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  check('build · her own pieces hang in the rack, attributed to Robes',
    b.rows.length === 3 && b.robes === 'Robes', JSON.stringify([b.rows, b.robes]));
  check('build · one shop suggestion covers the slot her wardrobe cannot',
    b.shop.length === 1 && b.shop[0] === 'Cropped Bouclé Jacket', JSON.stringify(b.shop));
  check('build · a proposal carries only Swap and Save',
    JSON.stringify(b.shopActs) === JSON.stringify(['Swap', 'Save']), JSON.stringify(b.shopActs));
  // No image carousel until the look is saved — it belongs to the saved card
  check('build · no carousel and no remove on an unsaved build',
    b.flicks === 0 && b.removes === 0, JSON.stringify([b.flicks, b.removes]));
  check('build · the name lands last, offered not applied',
    !!b.title && /Yours to change/.test(b.note || ''), JSON.stringify([b.title, b.note]));
  check('build · the stylist note reads on the panel',
    b.quote === BUILD_NOTE.note, JSON.stringify(b.quote));
  check('build · the look arrives filed — tags on the row, texture under the mosaic',
    b.tags.length >= 1 && b.fabrics >= 1, JSON.stringify([b.tags, b.fabrics]));
  check('build · a proposal is the shared rack row — slot label on the frame, row note beneath',
    /Jacket/.test(b.slotEye || '') && !!b.hownote, JSON.stringify([b.slotEye, b.hownote]));
  check('build · the proposal carries the same Swap (icon) and Save components as every rack card',
    b.swapIcon === true && b.saveCls === true, JSON.stringify([b.swapIcon, b.saveCls]));
  check('build · the photo door reads Replace the photo', b.photo === 'Replace the photo', b.photo);
  check('build · Save leads; Try another and Wear it today follow',
    b.saveDisabled === false && JSON.stringify(b.foot) === JSON.stringify(['Try another', 'Wear it today']),
    JSON.stringify([b.saveDisabled, b.foot]));
  check('build · nothing is written until she saves',
    !writes.some((w) => w.method === 'POST' && /^looks/.test(w.url)),
    JSON.stringify(writes.map((w) => w.method + ' ' + w.url)));

  // Swap cycles the suggestion without touching the rest of the look
  const swapped = await page.evaluate(async () => {
    window.__lkShopSwap(0);
    await new Promise((r) => setTimeout(r, 200));
    return {
      shop: document.querySelector('.rb-lk-prop .rbc-name')?.textContent,
      rows: Array.from(document.querySelectorAll('.rbc-rack .rbc-row:not(.rb-lk-prop) .rbc-name')).map((n) => n.textContent),
    };
  });
  check('build · Swap moves to the next suggestion, the look intact',
    swapped.shop === 'Wide Wool Trouser' && swapped.rows.length === 3, JSON.stringify(swapped));

  // Save keeps the piece — the wishlist is where an unowned piece lives
  const kept = await page.evaluate(async () => {
    window.__lkShopSave(0);
    await new Promise((r) => setTimeout(r, 400));
    return { label: document.querySelector('.rb-lk-prop .rbc-act.done')?.textContent };
  });
  check('build · Save keeps the proposal, and says so', /Saved/.test(kept.label || ''), kept.label);
  await page.waitForTimeout(400);
  check('build · a kept proposal lands in the wishlist',
    writes.some((w) => w.method === 'POST' && /^wishlist_items/.test(w.url)),
    JSON.stringify(writes.map((w) => w.url).slice(-4)));
  await ctx.close();
}


{
  // A proposed piece has no wardrobe photograph, so Robes shoots a
  // still-life for it — without one the rack thumbs and the look board sit
  // empty, which is what a photograph-less wardrobe hits every time.
  const { ctx, page, errs } = await boot(browser, { seed: false, pics: 1 });
  await page.route('**/api/alternates', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALTS) }));
  await routeBuildNote(page);
  await page.route('**res.cloudinary.com/**', (r) => r.abort());
  let jobBody = null;
  await page.route('**/api/lookbuild/images', (r) => {
    try { jobBody = r.request().postDataJSON(); } catch (_) {}
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'j1', imageCount: 3 }) });
  });
  await page.route('**/api/images/j1', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ images: ['https://img.test/a.jpg', 'https://img.test/b.jpg', 'https://img.test/c.jpg'], done: true }),
  }));
  await page.route('**img.test/**', (r) => r.abort());
  await openLooks(page);
  await page.evaluate(() => window.__lkRobesBuild());
  await page.waitForTimeout(2800);
  const pending = await page.evaluate(() => ({
    placeholders: document.querySelectorAll('.rb-lk-prop .rb-lk-shopph').length,
    boardTiles: document.querySelectorAll('.rbc-board .rbc-tile').length,
  }));
  check('imagery · the look board carries the proposals, not just what she owns',
    pending.boardTiles === 4, JSON.stringify(pending));
  check('imagery · a proposal waits behind a labelled block, never a blank',
    pending.placeholders > 0, JSON.stringify(pending));
  check('imagery · Robes is asked for a still-life of every proposal',
    !!jobBody && jobBody.pieces.length === 3 && jobBody.pieces.every((p) => !!p.name),
    JSON.stringify(jobBody));
  await page.waitForTimeout(5000);
  const landed = await page.evaluate(() => ({
    thumbs: document.querySelectorAll('.rb-lk-prop .rbc-vp img').length,
    boardImgs: document.querySelectorAll('.rbc-board .rbc-tile img').length,
    placeholders: document.querySelectorAll('.rb-lk-shopph').length,
  }));
  check('imagery · the frames land in the rack thumbs and on the board',
    landed.thumbs === 3 && landed.boardImgs >= 3 && landed.placeholders === 0,
    JSON.stringify(landed));
  check('imagery · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  await ctx.close();
}

{
  // Nothing photographed at all: the look is entirely proposed. The panel
  // must still draw it (it used to fall through to "The look, once you
  // start"), and Save is open — with the wishlist said out loud first.
  const { ctx, page, errs, writes } = await boot(browser, { seed: false, pics: 0 });
  await page.route('**/api/alternates', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALTS) }));
  await routeBuildNote(page);
  await page.route('**/api/lookbuild/images', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'j3', imageCount: 4 }) }));
  await page.route('**/api/images/j3', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ images: ['https://img.test/1.jpg', 'https://img.test/2.jpg', 'https://img.test/3.jpg', 'https://img.test/4.jpg'], done: true }),
  }));
  await page.route('**img.test/**', (r) => r.abort());
  await openLooks(page);
  await page.evaluate(() => window.__lkRobesBuild());
  await page.waitForTimeout(7000);
  const z = await page.evaluate(() => ({
    placeholder: /once you start/.test(document.getElementById('rb-lk-body')?.textContent || ''),
    board: document.querySelectorAll('.rbc-board .rbc-tile').length,
    boardImgs: document.querySelectorAll('.rbc-board .rbc-tile img').length,
    head: document.querySelector('.rbc-lhead .lab')?.textContent,
    yours: document.querySelector('.rbc-yours')?.textContent,
    saveDisabled: document.querySelector('.rb-lk-save')?.disabled,
  }));
  check('nothing owned · the look still draws — never the "once you start" state',
    z.placeholder === false && z.board === 4 && z.boardImgs === 4, JSON.stringify(z));
  check('nothing owned · the head and the ownership line count the whole look',
    z.head === 'The look · 0 yours, 4 to find' && /0.of.4 from your wardrobe/.test(z.yours || ''),
    JSON.stringify([z.head, z.yours]));
  check('nothing owned · Save is open', z.saveDisabled === false);

  const ask = await page.evaluate(async () => {
    document.querySelector('.rb-lk-save').click();
    await new Promise((r) => setTimeout(r, 250));
    const m = document.getElementById('rb-del-modal');
    return { open: !!m, text: (m?.textContent || '').replace(/\s+/g, ' ') };
  });
  check('nothing owned · Save says where the unowned pieces go, before it happens',
    ask.open === true && /aren.t yours yet/.test(ask.text) && /Wishlist/.test(ask.text), ask.text.slice(0, 120));

  const done = await page.evaluate(async () => {
    document.getElementById('rb-lksave-yes').click();
    await new Promise((r) => setTimeout(r, 800));
    return {
      grid: document.querySelectorAll('#rb-lk-grid .lt-card').length,
      gone: !document.getElementById('rb-del-modal'),
    };
  });
  check('nothing owned · the look saves', done.grid === 1 && done.gone === true, JSON.stringify(done));
  await page.waitForTimeout(500);
  const lookWrite = writes.filter((w) => w.method === 'POST' && /^looks/.test(w.url)).pop();
  check('nothing owned · it carries its own imagery, never a blank card',
    !!lookWrite && /^https?:/.test(lookWrite.body?.photo_url || ''), JSON.stringify(lookWrite?.body?.photo_url));
  check('nothing owned · the stylist note travels onto the saved look',
    lookWrite?.body?.note === BUILD_NOTE.note, JSON.stringify(lookWrite?.body?.note));
  check('nothing owned · the proposals ride the saved look row whole',
    Array.isArray(lookWrite?.body?.proposals) && lookWrite.body.proposals.length === 4
      && lookWrite.body.proposals.every((r) => Array.isArray(r.opts) && r.opts.length > 0),
    JSON.stringify((lookWrite?.body?.proposals || []).length));
  check('nothing owned · and every proposal lands in the wishlist',
    writes.filter((w) => w.method === 'POST' && /^wishlist_items/.test(w.url)).length >= 1,
    JSON.stringify(writes.map((w) => w.url).slice(-6)));

  // The saved zero-owned look's detail: no dead wear verbs, no zeroed
  // ledger — the wishlist door and an honest rack line instead.
  const det = await page.evaluate(async () => {
    document.querySelector('#rb-lk-grid .lt-card')?.click();
    await new Promise((r) => setTimeout(r, 700));
    const body = document.getElementById('rb-lk-body');
    return {
      acts: Array.from(document.querySelectorAll('.rb-lk-actrow button')).map((x) => x.textContent),
      wishDoor: /Open your wishlist/.test(body?.textContent || ''),
      stats: document.querySelectorAll('.rb-lk-ledger').length,
      props: document.querySelectorAll('.rbc-rack .rb-lk-prop').length,
      board: document.querySelectorAll('.rbc-board .rbc-tile').length,
      head: document.querySelector('.rbc-lhead .lab')?.textContent,
      propActs: Array.from(document.querySelectorAll('.rbc-rack .rb-lk-prop .rbc-act')).map((x) => x.textContent.trim()),
      arrows: document.querySelectorAll('.rbc-rack .rb-lk-prop .rbc-arrow').length,
      quote: document.querySelector('.rbc-quote')?.textContent,
    };
  });
  check('nothing owned · the saved detail offers the wishlist, never dead wear verbs',
    det.acts.length === 0 && det.wishDoor === true, JSON.stringify([det.acts, det.wishDoor]));
  check('nothing owned · the saved look reopens WHOLE — mosaic and rack cards, like the composer',
    det.props === 4 && det.board === 4 && det.head === 'The look · 0 yours, 4 to find',
    JSON.stringify([det.props, det.board, det.head]));
  check('nothing owned · saved proposals keep Swap, and read as already kept to the wishlist',
    det.propActs.filter((x) => x === 'Swap').length === 4 && det.propActs.filter((x) => /Saved/.test(x)).length === 4,
    JSON.stringify(det.propActs));
  check('nothing owned · no zeroed stats ledger', det.stats === 0, JSON.stringify(det.stats));
  // Superseded 2026-08-17: a proposal is never flicked into another
  // suggestion — the cluster is reserved for pieces she owns; Swap stays.
  check('nothing owned · saved proposals carry NO flick cluster',
    det.arrows === 0, JSON.stringify(det.arrows));
  check('nothing owned · the note reads back on the saved look',
    det.quote === BUILD_NOTE.note, JSON.stringify(det.quote));

  // Swap on a saved proposal opens the shared modal (third pass, Annie:
  // "hitting swap should open the modal") — and picking an owned piece is
  // the moment the look becomes hers: proposal off the rack, piece onto
  // look_pieces, the wear verbs return.
  const swapM = await page.evaluate(async () => {
    const btn = Array.from(document.querySelectorAll('.rbc-rack .rb-lk-prop button.rbc-act')).find((x) => /Swap/.test(x.textContent));
    btn?.click();
    await new Promise((r) => setTimeout(r, 250));
    const m = document.getElementById('rb-lkprop-swap');
    return {
      open: !!m,
      wardrobe: /From your wardrobe/.test(m?.textContent || ''),
      snap: /Snap mine/.test(m?.textContent || ''),
      // Audit 6.2 (2026-08-19): the affiliate coming-soon dead end is
      // replaced by a real Save-to-wishlist in the shared modal.
      affiliate: /Save to wishlist/.test(m?.textContent || ''),
    };
  });
  check('nothing owned · Swap on a saved proposal opens the swap modal, daily-style',
    swapM.open === true && swapM.wardrobe === true && swapM.snap === true && swapM.affiliate === true,
    JSON.stringify(swapM));
  const adopted = await page.evaluate(async () => {
    const card = document.querySelector('#rb-lkprop-swap [onclick*="__lkPropSwapApply"]');
    card?.click();
    await new Promise((r) => setTimeout(r, 600));
    return {
      picked: !!card,
      props: document.querySelectorAll('.rbc-rack .rb-lk-prop').length,
      ownedRows: document.querySelectorAll('.rbc-rack .rbc-row:not(.rb-lk-prop) .rbc-name').length,
      acts: Array.from(document.querySelectorAll('.rb-lk-actrow button')).map((x) => x.textContent).length,
      modalGone: !document.getElementById('rb-lkprop-swap'),
    };
  });
  check('nothing owned · picking an owned piece moves it ONTO the look — proposal off, wear verbs back',
    adopted.picked === true && adopted.props === 3 && adopted.ownedRows === 1
      && adopted.acts === 2 && adopted.modalGone === true,
    JSON.stringify(adopted));
  check('nothing owned · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  await ctx.close();
}

{
  const { ctx, page, errs } = await boot(browser, { seed: false, pics: 1 });
  await page.route('**/api/alternates', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALTS) }));
  await routeBuildNote(page);
  await page.route('**/api/lookbuild/images', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'j2', imageCount: 3 }) }));
  await page.route('**/api/images/j2', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: [null, null, null], done: false }) }));
  await page.route('**res.cloudinary.com/**', (r) => r.abort());
  await openLooks(page);
  await page.evaluate(() => {
    window.__robes_profile = Object.assign({}, window.__robes_profile || {},
      { style_icons: ['Margot Robbie', 'Chanel'] });
    window.__lkRobesBuild();
  });
  await page.waitForTimeout(2800);
  check('aspirational · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  const a = await page.evaluate(() => ({
    head: document.querySelector('.rbc-lhead .lab')?.textContent,
    rows: Array.from(document.querySelectorAll('.rbc-rack .rbc-row:not(.rb-lk-prop) .rbc-name')).map((n) => n.textContent),
    shop: document.querySelectorAll('.rb-lk-prop').length,
    chips: Array.from(document.querySelectorAll('.rb-lk-prop .rb-lk-shopph span')).map((c) => c.textContent),
    prov: document.querySelector('.rb-lk-prop .rbc-sub')?.textContent,
    title: document.getElementById('rb-lk-newtitle')?.value,
    foot: Array.from(document.querySelectorAll('.rb-lk-buildfoot button')).map((x) => x.textContent),
  }));
  check('aspirational · one of hers, three to find, and the head says so',
    a.rows.length === 1 && a.shop === 3 && a.head === 'The look · 1 yours, 3 to find',
    JSON.stringify([a.rows, a.shop, a.head]));
  check('aspirational · each proposal is a full piece card with its category chip and provenance',
    JSON.stringify(a.chips) === JSON.stringify(['Trousers', 'Jacket', 'Shoes'])
      && /Sézane|Toteme/.test(a.prov || ''), JSON.stringify([a.chips, a.prov]));
  check('aspirational · the title comes from her icons, not the pieces',
    a.title === 'Margot Robbie meets Chanel.', a.title);
  check('aspirational · Wear it today is withheld; the exit is Build from mine only',
    JSON.stringify(a.foot) === JSON.stringify(['Try another', 'Build from mine only']),
    JSON.stringify(a.foot));
  const mine = await page.evaluate(async () => {
    window.__lkBuildMineOnly();
    await new Promise((r) => setTimeout(r, 2000));
    return {
      shop: document.querySelectorAll('.rb-lk-shop').length,
      gaps: Array.from(document.querySelectorAll('.rbc-rghost .rbc-rolenote')).map((n) => n.textContent),
      foot: Array.from(document.querySelectorAll('.rb-lk-buildfoot button')).map((x) => x.textContent),
    };
  });
  check('aspirational · Build from mine only drops every proposal',
    mine.shop === 0 && mine.gaps.length === 3
      && mine.gaps.every((g) => /Nothing in your wardrobe fits here yet/.test(g)),
    JSON.stringify(mine));
  check('aspirational · …and Wear it today returns with it',
    JSON.stringify(mine.foot) === JSON.stringify(['Try another', 'Wear it today']), JSON.stringify(mine.foot));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 6 · Early days — the empty state (A1)
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs } = await boot(browser, { seed: false });
  await openLooks(page);
  // ONE DOOR (2026-08-12): a truly empty account IS the composer — no
  // "Ways to fill it" clone shelf, no holiday CTA, no concierge menu, and
  // nothing else on the page to compete with naming the first look.
  const cold = await page.evaluate(() => ({
    waysShown: (() => { const el = document.getElementById('sn-empty'); return !!el && el.style.display !== 'none'; })(),
    waysCards: document.querySelectorAll('#sn-ways .svc').length,
    composer: !!document.querySelector('.rb-lk-composer > .rb-lk-con'),
    title: document.getElementById('rb-lk-newtitle')?.placeholder,
    barHidden: document.getElementById('rb-lk-bar')?.style.display === 'none',
    holHidden: document.getElementById('rb-lk-hol')?.style.display === 'none',
    allHeadHidden: document.getElementById('rb-lk-allhead')?.style.display === 'none',
    sort: !!document.querySelector('.rb-lk-sort'),
    seg: !!document.getElementById('sn-viewseg'),
  }));
  check('empty · ONE DOOR — the empty Lookbook IS the composer, no ways-to-fill shelf',
    cold.composer === true && cold.title === 'Name your first look'
      && cold.waysShown === false && cold.waysCards === 0, JSON.stringify(cold));
  check('empty · nothing competes with it — no travel strip, All-looks header, sort or refine',
    cold.barHidden && cold.holHidden && cold.allHeadHidden && cold.sort === false,
    JSON.stringify([cold.barHidden, cold.holHidden, cold.allHeadHidden, cold.sort]));
  // The Diary is its own tab (2026-09-08) — it opens even at zero looks,
  // and the Lookbook tab brings her back to the composer untouched.
  const diary = await page.evaluate(async () => {
    document.getElementById('rb-tn-diary').click();
    await new Promise((r) => setTimeout(r, 450));
    const calOn = document.getElementById('sn-page')?.classList.contains('rb-cal-on');
    const eyebrow = document.getElementById('sn-eyebrow')?.textContent;
    const diaryLit = document.getElementById('rb-tn-diary')?.classList.contains('active');
    document.getElementById('rb-tn-lookbook').click();
    await new Promise((r) => setTimeout(r, 450));
    return {
      calOn, eyebrow, diaryLit,
      calOff: !document.getElementById('sn-page')?.classList.contains('rb-cal-on'),
      eyebrowBack: document.getElementById('sn-eyebrow')?.textContent,
      stillComposer: !!document.querySelector('.rb-lk-composer > .rb-lk-con'),
    };
  });
  check('empty · no in-page segment; the Diary tab opens the Diary at zero looks and the Lookbook tab returns to the composer',
    cold.seg === false && diary.calOn === true && diary.eyebrow === 'Diary' && diary.diaryLit === true
      && diary.calOff === true && diary.eyebrowBack === 'Lookbook' && diary.stillComposer === true, JSON.stringify(diary));
  // A key piece alone does NOT fill the Lookbook — it lives on Inspiration
  // (IA refinement 2026-08-10). The one door holds.
  await page.evaluate(() => {
    localStorage.setItem('robes_style_notes__u-test',
      JSON.stringify([{ id: 1754630000000, type: 'key-piece', title: 'A piece', subtitle: 'Worn three ways', img: null }]));
    window.__lkGo();
  });
  await page.waitForTimeout(300);
  const kpOnly = await page.evaluate(() => ({
    composer: !!document.querySelector('.rb-lk-composer > .rb-lk-con'),
    waysShown: (() => { const el = document.getElementById('sn-empty'); return !!el && el.style.display !== 'none'; })(),
  }));
  check('empty · a key piece alone leaves the Lookbook on its one door (it lives on Inspiration)',
    kpOnly.composer === true && kpOnly.waysShown === false, JSON.stringify(kpOnly));
  // A daily look is a DAY (Look Rules 1a) — it lives in the Diary and is
  // reached from a day cell, never from the Lookbook. The Lookbook holds
  // saved looks only, so an account with nothing but days still meets the
  // composer, its one door.
  await page.evaluate(() => {
    localStorage.setItem('robes_style_notes__u-test',
      JSON.stringify([{ id: 1754640000000, type: 'daily-look', title: 'A look', subtitle: 'Daily look · Tuesday', img: null,
        dlData: { anchor_date: '2026-08-05', worn: true } }]));
    window.__lkGo();
  });
  await page.waitForTimeout(300);
  const dayOnly = await page.evaluate(() => ({
    cards: document.querySelectorAll('#rb-lk-grid .lt-card').length,
    composer: !!document.querySelector('.rb-lk-composer > .rb-lk-con'),
  }));
  check('empty · a day is not a look — it stays out of the Lookbook grid',
    dayOnly.cards === 0 && dayOnly.composer === true, JSON.stringify(dayOnly));
  // A legacy 'look' item still fills the shelf: it has nowhere else to live.
  await page.evaluate(() => {
    localStorage.setItem('robes_style_notes__u-test',
      JSON.stringify([{ id: 1754640000000, type: 'look', title: 'A look', subtitle: 'Look', img: null }]));
    window.__lkGo();
  });
  await page.waitForTimeout(300);
  const e = await page.evaluate(() => ({
    itemCards: document.querySelectorAll('#rb-lk-grid .lt-card').length,
    eyebrow: document.querySelector('#rb-lk-grid .lt-ey')?.textContent,
    meta: document.querySelector('#rb-lk-grid .lt-meta')?.textContent,
    addCard: !!document.querySelector('#rb-lk-grid .rb-add-card'),
    moduleEmpty: !!document.querySelector('.rb-lk-empty'),
    sorts: Array.from(document.querySelectorAll('.rb-lk-sort')).map((b) => b.disabled),
    stat: document.querySelector('.rb-lk-statline')?.textContent,
    // The travel strip arrives with the first look: invitation + ONE
    // dimmed, labelled Robes example (2026-08-12)
    holShown: document.getElementById('rb-lk-hol')?.style.display === 'block',
    holSec: document.querySelector('#rb-lk-hol .rb-lk-sec')?.textContent,
    invite: document.querySelector('#rb-lk-hol .rb-lk-holcard.invite')?.textContent,
    example: document.querySelector('#rb-lk-hol .rb-lk-holcard.example')?.textContent,
    exampleInert: (() => {
      const el = document.querySelector('#rb-lk-hol .rb-lk-holcard.example');
      return !!el && el.tagName !== 'BUTTON' && getComputedStyle(el).pointerEvents === 'none';
    })(),
    holNew: !!document.querySelector('#rb-lk-hol .rb-lk-holcard.new'),
  }));
  check('empty · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  check('empty · a legacy look item still fills the shelf',
    e.itemCards === 1 && e.addCard === true, JSON.stringify(e));
  check('empty · it draws in the one card language — eyebrow Look',
    e.eyebrow === 'Look', JSON.stringify([e.eyebrow, e.meta]));
  check('empty · no module empty state once anything exists', e.moduleEmpty === false);
  // Superseded 2026-08-12: sort and Refine RENDER at every count and sit
  // inert below four looks, rather than appearing from nowhere.
  check('empty · sort and Refine render inert below four looks; the stat names the gap',
    JSON.stringify(e.sorts) === JSON.stringify([true, true]) && e.stat === '1 look · no edits yet',
    JSON.stringify([e.sorts, e.stat]));
  check('empty · the first look brings the travel strip: invitation + one dimmed Robes example',
    e.holShown === true && e.holSec === 'Travel edit'
      && /Plan a trip\./.test(e.invite || '') && /Start planning/.test(e.invite || '')
      && /A chic Ibiza escape/.test(e.example || '') && /5 looks · 7–14 Aug/.test(e.example || '')
      && e.exampleInert === true && e.holNew === false,
    JSON.stringify([e.holShown, e.holSec, e.invite, e.example, e.exampleInert, e.holNew]));
  // The meta line now reads like a real trip, so the example marker must
  // survive somewhere on the card — dimming alone is not a label.
  check('empty · the example is still unmistakably an example',
    /Robes example/.test(e.example || ''), e.example);
  // FTUE wording on the composer's one alternative door — she has no looks
  // yet, so Robes offers to build the FIRST one (2026-08-12).
  const ftue = await page.evaluate(() => {
    window.__lkNew();
    return {
      door: document.querySelector('.rb-lk-robesdoor')?.textContent,
      card: !!document.querySelector('.rb-lk-composer > .rb-lk-con'),
      saveDisabled: document.querySelector('.rb-lk-save')?.disabled,
    };
  });
  check('empty · the first-time composer carries no Robes door, and Save is live',
    ftue.door === undefined && ftue.card === true && ftue.saveDisabled === false,
    JSON.stringify(ftue));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 7 · Degradation — the migration hasn't run
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs } = await boot(browser, { looksTable: false });
  await openLooks(page);
  const g = await page.evaluate(() => {
    window.__lkNew();
    window.__lkRowPick('r1', 'w-top1');
    window.__lkRowPick('r3', 'w-sho1');
    window.__lkNewTitleInput('Terrace mornings');   // rule 02 holds here too
    window.__lkSave();
    return { tiles: document.querySelectorAll('#rb-lk-grid .rb-lk-tile').length };
  });
  check('degrade · no page errors when the tables are missing', errs.length === 0, errs.join(' | ').slice(0, 240));
  check('degrade · a look still saves locally and lands on the grid', g.tiles === 1, String(g.tiles));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 8 · Mobile — 390px
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs } = await boot(browser, { width: 390 });
  await openLooks(page);
  const m = await page.evaluate(() => {
    const grid = document.getElementById('rb-lk-grid');
    return {
      cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      metaVisible: getComputedStyle(document.querySelector('#rb-lk-grid .lt-meta')).opacity === '1',
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  check('390px · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  check('390px · one-up grid, matching the item shelves', m.cols === 1, String(m.cols));
  check('390px · metadata is printed where there is no hover', m.metaVisible === true);
  check('390px · no horizontal overflow on the grid', m.overflow === true);

  const md = await page.evaluate(() => {
    window.__lkOpen('lk-1');
    window.__lkEditToggle();   // the touch targets live on the editable rack
    const det = document.querySelector('.rb-lk-con');
    const ey = document.querySelector('.rbc-rackhead .ey');
    const vslot = document.querySelector('.rbc-vp .vslot');
    const mslot = document.querySelector('.rbc-mslot');
    const badge = document.querySelector('.rbc-share-m');
    const action = document.querySelector('.rbc-action');
    const arrow = document.querySelector('.rbc-arrow');
    const act = document.querySelector('.rbc-acts .rbc-act');
    return {
      stacked: det ? getComputedStyle(det).gridTemplateColumns.split(' ').length === 1 : false,
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      actions: document.querySelectorAll('.rb-lk-actrow button').length,
      rackEyHidden: ey ? getComputedStyle(ey).display === 'none' : true,
      vslotHidden: vslot ? getComputedStyle(vslot).display === 'none' : true,
      mslotShown: mslot ? getComputedStyle(mslot).display !== 'none' : false,
      badgeShown: badge ? getComputedStyle(badge).display !== 'none' : false,
      actionHidden: action ? getComputedStyle(action).display === 'none' : true,
      arrowH: arrow ? Math.round(arrow.getBoundingClientRect().height) : 0,
      actH: act ? Math.round(act.getBoundingClientRect().height) : 0,
    };
  });
  check('390px · detail stacks', md.stacked === true);
  check('390px · both actions survive — the pill and the calendar', md.actions === 2, String(md.actions));
  check('390px · no horizontal overflow on the detail', md.overflow === true);
  // Spec E · mobile parity
  check('390px E · one header — the rack\'s duplicate eyebrow folds away', md.rackEyHidden === true);
  check('390px E · slot and status share the row eyebrow',
    md.vslotHidden === true && md.mslotShown === true, JSON.stringify([md.vslotHidden, md.mslotShown]));
  // The Look detail carries no Share (Wear/Pin/Pack are its actions), so
  // the badge contract is probed on a synthetic console fragment — the
  // three generated consoles emit the same markup via cfg.lookActionHtml.
  const share = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="rbc-board"><button class="rbc-share-m">s</button></div><div class="rbc-action"><button>Share</button></div>';
    document.body.appendChild(host);
    const out = {
      badgeShown: getComputedStyle(host.querySelector('.rbc-share-m')).display !== 'none',
      actionHidden: getComputedStyle(host.querySelector('.rbc-action')).display === 'none',
      detailBadge: !!document.querySelector('.rb-lk-con .rbc-share-m'),
    };
    host.remove();
    return out;
  });
  check('390px E · Share compresses to a badge on the mosaic, footer stays free',
    share.badgeShown === true && share.actionHidden === true && share.detailBadge === false, JSON.stringify(share));
  check('390px E · every action survives at 44px touch height',
    md.arrowH >= 44 && md.actH >= 44, JSON.stringify([md.arrowH, md.actH]));

  const mc = await page.evaluate(() => {
    window.__lkNew();
    window.__lkApplyNew('w-top1');   // the empty composer holds no rows now — measure a filled one
    const n = document.querySelector('.rb-lk-con');
    window.__lkApplyNew('w-bot1');   // two pieces: Save comes live
    const save = document.querySelector('.rb-lk-save');
    const row = document.querySelector('.rb-lk-saverow');
    const card = document.querySelector('.rb-lk-composer');
    return {
      stacked: n ? getComputedStyle(n).gridTemplateColumns.split(' ').length === 1 : false,
      rowsFullWidth: (() => {
        const r = document.querySelector('.rbc-row');
        const rack = document.querySelector('.rbc-rack');
        return !!r && !!rack && Math.abs(r.getBoundingClientRect().width - rack.getBoundingClientRect().width) < 2;
      })(),
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      // One card holding the whole composer, the name leading it outside
      inCard: !!document.querySelector('.rb-lk-composer > .rb-lk-con'),
      titleOutside: !document.querySelector('.rb-lk-composer #rb-lk-newtitle')
        && !!document.querySelector('.rb-lk-newmast #rb-lk-newtitle'),
      // Save stacks full width over the Robes door, and clears 44px
      saveStacks: !!row && getComputedStyle(row).flexDirection === 'column',
      saveFull: !!save && !!card
        && Math.abs(save.getBoundingClientRect().width - (card.getBoundingClientRect().width - 32)) < 3,
      saveH: save ? Math.round(save.getBoundingClientRect().height) : 0,
      door: document.querySelector('.rb-lk-robesdoor')?.textContent,
    };
  });
  check('390px · composer stacks the card above the rack', mc.stacked === true);
  check('390px · rack rows run full width (no cramped shelf)', mc.rowsFullWidth === true);
  check('390px · no horizontal overflow on the composer', mc.overflow === true);
  check('390px · the composer is one card, the name leading it from outside',
    mc.inCard === true && mc.titleOutside === true, JSON.stringify([mc.inCard, mc.titleOutside]));
  check('390px · Save runs full width at 44px+, no Robes door beneath it',
    mc.saveStacks === true && mc.saveFull === true && mc.saveH >= 44 && mc.door === undefined,
    JSON.stringify([mc.saveStacks, mc.saveFull, mc.saveH, mc.door]));
  // Save is the last thing on the page and the dock is fixed over it —
  // scrolled to the foot, the commitment must clear the dock.
  const clear = await page.evaluate(async () => {
    // #sn-page is a fixed overlay with its own scroller — scrolling the
    // window would leave the composer exactly where it was.
    const sc = document.getElementById('sn-page');
    if (sc) sc.scrollTop = sc.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 200));
    const save = document.querySelector('.rb-lk-save')?.getBoundingClientRect();
    const dock = document.getElementById('rb-dock');
    const d = dock && getComputedStyle(dock).display !== 'none' ? dock.getBoundingClientRect() : null;
    return { saveBottom: save ? Math.round(save.bottom) : null, dockTop: d ? Math.round(d.top) : null };
  });
  check('390px · Save clears the fixed dock at the foot of the page',
    clear.saveBottom != null && (clear.dockTop == null || clear.saveBottom <= clear.dockTop),
    JSON.stringify(clear));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 9 · IA — three tabs, three tenses (2026-08-08): the legacy Looks door,
// Wear on a card, the Calendar tab, and the empty-day wear-a-look flow
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, writes } = await boot(browser);

  // The legacy door: __waSetView('looks') redirects out of the wardrobe
  // onto the Lookbook's All looks shelf.
  await page.evaluate(() => window.App && window.App.showWardrobe && window.App.showWardrobe());
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__waSetView('looks'));
  await page.waitForTimeout(600);
  const legacy = await page.evaluate(() => ({
    snOpen: document.getElementById('sn-page').style.display === 'block',
    wrapShown: (() => { const el = document.getElementById('rb-lk-wrap'); return !!el && el.offsetParent !== null; })(),
    wardrobeClosed: !document.querySelector('.wardrobe-panel')?.classList.contains('visible'),
    path: location.pathname,
  }));
  check('IA · the legacy Looks door lands on the Lookbook shelf',
    legacy.snOpen && legacy.wrapShown && legacy.wardrobeClosed && legacy.path === '/lookbook',
    JSON.stringify(legacy));

  // Wear on the card opens the detail with the day question armed.
  const cardWear = await page.evaluate(() => {
    const w = document.querySelector('.rb-lk-tilewrap .rb-lk-wearx');
    if (w) w.click();
    return {
      had: !!w,
      panel: document.querySelector('.rb-lk-panel .pl')?.textContent,
      actions: Array.from(document.querySelectorAll('.rb-lk-actrow button')).map((b) => b.textContent),
    };
  });
  check('IA · a card\'s Wear opens the detail asking which day',
    cardWear.had && /Which day\?/.test(cardWear.panel || ''), JSON.stringify(cardWear));

  // The unified stream (cohesion pass): a saved daily look joins the looks
  // in one card language; a holiday edit rides the pinned row above it,
  // and a key piece stays off the page entirely (it lives on Inspiration).
  const uni = await page.evaluate(() => {
    localStorage.setItem('robes_style_notes__u-test', JSON.stringify([
      { id: 1754640000000, type: 'daily-look', title: 'A Dublin day', subtitle: 'Daily look · Wednesday', img: null },
      { id: 1754640000001, type: 'travel-edit', title: 'Ibiza holiday edit', subtitle: 'Travel edit · Ibiza', img: null,
        tvData: { capsule: Array(12).fill({}), looks: Array(6).fill({}), dateFrom: '2026-08-07', tripDays: 8 } },
      { id: 1754640000002, type: 'key-piece', title: 'Umbro shorts', subtitle: 'Worn three ways', img: null },
    ]));
    window.__lkGo();
    const hol = document.getElementById('rb-lk-hol');
    return {
      cards: document.querySelectorAll('#rb-lk-grid .lt-card').length,
      eyebrows: Array.from(document.querySelectorAll('#rb-lk-grid .lt-ey')).map((e) => e.textContent).sort(),
      itemCard: Array.from(document.querySelectorAll('#rb-lk-grid .lt-card')).some((c) => /A Dublin day/.test(c.textContent)),
      kpInStream: /Umbro shorts/.test(document.getElementById('rb-lk-grid')?.textContent || ''),
      holShown: !!hol && hol.style.display !== 'none',
      holCards: document.querySelectorAll('#rb-lk-hol .rb-lk-holcard:not(.new)').length,
      holMeta: document.querySelector('#rb-lk-hol .rb-lk-holcard .hm')?.textContent,
      holNew: !!document.querySelector('#rb-lk-hol .rb-lk-holcard.new'),
      newSplit: /\+ New ▾/.test(document.getElementById('rb-lk-bar')?.textContent || ''),
      stat: document.querySelector('#rb-lk-bar .rb-lk-statline')?.textContent,
      allRow: (() => {
        const row = document.querySelector('#rb-lk-allhead .rb-lk-allrow');
        return {
          label: row?.querySelector('.rb-lk-sec')?.textContent,
          sortHere: !!row?.querySelector('.rb-lk-sort'),
          sortInBar: !!document.querySelector('#rb-lk-bar .rb-lk-sort'),
        };
      })(),
    };
  });
  // The Lookbook holds SAVED LOOKS ONLY (Look Rules 1a): her two fixture
  // looks, in one card language. The daily look is a day and lives in the
  // Diary; the key piece lives on Inspiration; the travel edit rides its
  // own pinned strip.
  check('IA · the stream holds saved looks only, in one card language',
    uni.cards === 2 && uni.itemCard === false && JSON.stringify(uni.eyebrows) === JSON.stringify(['Look', 'Look']),
    JSON.stringify(uni));
  check('IA · a key piece never enters the Lookbook stream', uni.kpInStream === false);
  // "Travel edit" is the noun everywhere now (Annie, 2026-08-12) — the
  // strip, the stat line and the + New split all say it; "holiday" survives
  // only in function names and class hooks.
  const naming = await page.evaluate(() => {
    // Chrome only — a trip SHE named "Ibiza holiday edit" is her words
    window.__lkNewMenu(new MouseEvent('click'));
    const menu = document.getElementById('rb-lk-newmenu')?.textContent || '';
    document.getElementById('rb-lk-newmenu')?.remove();
    return {
      sec: document.querySelector('#rb-lk-hol .rb-lk-sec')?.textContent || '',
      stat: document.querySelector('#rb-lk-bar .rb-lk-statline')?.textContent || '',
      menu,
    };
  });
  check('IA · "Travel edit" is the noun in every piece of chrome',
    naming.sec === 'Travel edit' && /travel edit/.test(naming.stat) && /New travel edit/.test(naming.menu)
      && !/holiday/i.test(naming.sec + naming.stat + naming.menu),
    JSON.stringify(naming));
  // The dashed + New card retired with the column redesign (2026-08-18):
  // + New ▾ above is the creation door, the header count the affordance.
  check('IA · holiday edits ride the pinned row, mosaic cards on the column',
    uni.holShown && uni.holCards === 1 && uni.holNew === false && uni.holMeta === '12 pieces · 6 looks · 7–14 Aug',
    JSON.stringify([uni.holShown, uni.holCards, uni.holNew, uni.holMeta]));
  check('IA · one + New button, split two ways', uni.newSplit === true);
  check('IA · the top row carries the collection stat; sort/Refine align with All looks',
    uni.stat === '2 looks · 1 travel edit' && uni.allRow.label === 'All looks'
      && uni.allRow.sortHere === true && uni.allRow.sortInBar === false,
    JSON.stringify([uni.stat, uni.allRow]));
  const split = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#rb-lk-bar button')).find((b) => /\+ New ▾/.test(b.textContent));
    btn.click();
    const menu = document.getElementById('rb-lk-newmenu');
    const opts = menu ? Array.from(menu.querySelectorAll('.card button')).map((b) => b.textContent) : [];
    menu?.remove();
    return { opts };
  });
  check('IA · the split offers New Look and New travel edit',
    JSON.stringify(split.opts) === JSON.stringify(['New Look', 'New travel edit']), JSON.stringify(split.opts));

  // C1 — a Lookbook card opens the SAVED LOOK DETAIL: the look and its
  // history, no date, no weather, no share (Annie's beta catch 2026-08-17;
  // supersedes "a look card opens as it is worn"). The DAY is entered from
  // a diary cell only — probed below through __lkOpenAsDay, the cells' one
  // opener.
  const cardOpen = await page.evaluate(async () => {
    window.__lkCardOpen('lk-1');
    await new Promise((r) => setTimeout(r, 300));
    const dlEl = document.getElementById('dl-result-page');
    return {
      dlOpen: !!dlEl && dlEl.style.display !== 'none',
      detailTitle: document.getElementById('rb-lk-title')?.textContent,
      eyebrow: document.querySelector('.rb-lk-eyebrow')?.textContent,
      weather: !!document.querySelector('#rb-lk-body .dlm-wx'),
      share: /Share this look/.test(document.getElementById('rb-lk-body')?.textContent || ''),
    };
  });
  check('C1 · a Lookbook card opens the saved look detail, never the day',
    cardOpen.dlOpen === false && cardOpen.detailTitle === 'The Thursday one'
      && /^Saved look/.test(cardOpen.eyebrow || ''),
    JSON.stringify(cardOpen));
  check('C1 · no date, no weather, no share — those belong to the day',
    cardOpen.weather === false && cardOpen.share === false, JSON.stringify(cardOpen));

  const dayView = await page.evaluate(async () => {
    const p = (n) => String(n).padStart(2, '0');
    const t = new Date();
    const iso = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    window.__lkOpenAsDay({ source_id: 'lk-1', day_date: iso });
    await new Promise((r) => setTimeout(r, 300));
    const dl = document.getElementById('dl-result-page');
    const onTop = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return {
      open: !!dl && dl.style.display !== 'none',
      // The Lookbook page (z-45) MUST close — it sits above the daily
      // console (z-40), and leaving it open rendered the day invisibly
      // beneath (beta bug 2026-08-10: "I can't open a Look").
      snClosed: document.getElementById('sn-page').style.display === 'none',
      topIsDl: !!(onTop && onTop.closest && onTop.closest('#dl-result-page')),
      headline: document.querySelector('#dl-result-page .dlm-title')?.textContent,
      wearing: document.querySelector('#dl-result-page .dlm-wearing')?.textContent || '',
      rows: document.querySelectorAll('#dl-result-page .rbc-row').length,
      door: !!document.querySelector('#dl-result-page .dlm-lksrc button'),
      doorCopy: document.querySelector('#dl-result-page .dlm-lksrc')?.textContent || '',
      anchor: window.__lastDlData?.anchor_date,
      todayIso: (() => { const p = (n) => String(n).padStart(2, '0'); const t = new Date(); return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()); })(),
    };
  });
  // D1 — a diary-entered day wearing a saved look with no occasion titles
  // "Wearing {the look}", the date as its eyebrow. The look's name never
  // conflates with the day's own facts.
  check('D1 · the day titles "Wearing {look}", dated in the eyebrow',
    dayView.open && dayView.headline === 'Wearing The Thursday one'
      && dayView.rows === 4 && dayView.anchor === dayView.todayIso,
    JSON.stringify(dayView));
  check('IA · the day view actually lands ON TOP (the Lookbook closes under it)',
    dayView.snClosed === true && dayView.topIsDl === true, JSON.stringify([dayView.snClosed, dayView.topIsDl]));
  check('IA · the daily view keeps a quiet door to the Look details',
    dayView.door && /Saved in your Lookbook/.test(dayView.doorCopy), dayView.doorCopy);

  const back = await page.evaluate(async () => {
    document.querySelector('#dl-result-page .dlm-lksrc button').click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      dlClosed: document.getElementById('dl-result-page').style.display === 'none',
      detailTitle: document.getElementById('rb-lk-title')?.textContent,
    };
  });
  check('IA · the door lands on the Look detail',
    back.dlClosed && back.detailTitle === 'The Thursday one', JSON.stringify(back));

  // Worn on a calendar day → the card opens THAT day's daily view.
  const pinnedOpen = await page.evaluate(async () => {
    const p = (n) => String(n).padStart(2, '0');
    const t = new Date(Date.now() + 86400000);
    const iso = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    window.__lkPinTo(iso);   // the detail is active on lk-1 from the door
    await new Promise((r) => setTimeout(r, 200));
    window.__lkOpenAsDay({ source_id: 'lk-1', day_date: iso });   // the diary cell's opener
    await new Promise((r) => setTimeout(r, 300));
    return { anchor: window.__lastDlData?.anchor_date, target: iso };
  });
  check('IA · a look worn on a day opens as that day',
    pinnedOpen.anchor === pinnedOpen.target, JSON.stringify(pinnedOpen));
  await page.evaluate(() => { const dl = document.getElementById('dl-result-page'); if (dl) dl.style.display = 'none'; });

  // The Diary — a view inside the Lookbook (Calendar renamed 2026-08-10);
  // the legacy 'calendar' door still lands there.
  await page.evaluate(() => window.__rbNavGo('calendar'));
  await page.waitForTimeout(700);
  const cal = await page.evaluate(() => ({
    calShown: document.getElementById('sn-cal')?.style.display === 'block',
    calClass: document.getElementById('sn-page').classList.contains('rb-cal-on'),
    path: location.pathname,
    tnDiaryOn: document.getElementById('rb-tn-diary')?.classList.contains('active'),
    dockDiaryOn: document.getElementById('rb-dock-diary')?.classList.contains('active'),
    tnLookbook: document.getElementById('rb-tn-lookbook')?.classList.contains('active'),
    tnCalGone: !document.getElementById('rb-tn-calendar'),
    tnInsp: !!document.getElementById('rb-tn-inspiration'),
    dockInsp: !!document.getElementById('rb-dock-inspiration'),
    eyebrow: document.getElementById('sn-eyebrow')?.textContent,
    wrapHidden: (() => { const el = document.getElementById('rb-lk-wrap'); return !el || el.offsetParent === null; })(),
    monthTitle: document.querySelector('.rb-mv-title')?.textContent || '',
  }));
  check('IA · the Diary opens at /diary under its own eyebrow',
    cal.calShown && cal.calClass && cal.path === '/diary' && /\d{4}/.test(cal.monthTitle) && cal.eyebrow === 'Diary',
    JSON.stringify(cal));
  check('IA · the Diary tab lights (desktop + dock), the Lookbook does not; no legacy Calendar tab; Inspiration stands',
    cal.tnDiaryOn === true && cal.dockDiaryOn === true && cal.tnLookbook === false && cal.tnCalGone === true
      && cal.tnInsp === true && cal.dockInsp === true,
    JSON.stringify([cal.tnDiaryOn, cal.dockDiaryOn, cal.tnLookbook, cal.tnCalGone, cal.tnInsp, cal.dockInsp]));
  check('IA · the looks view yields under the Diary', cal.wrapHidden === true);

  // An empty future day offers "wear a look" — picking one pins it there.
  const wear = await page.evaluate(async () => {
    const p = (n) => String(n).padStart(2, '0');
    const t = new Date();
    const iso = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    const isMonthTail = t.getDate() === last;
    const cell = document.querySelector('#sn-cal .rb-dc[onclick*="__mvWear"]');
    const nxt = new Date(t.getTime() + 86400000);
    const niso = nxt.getFullYear() + '-' + p(nxt.getMonth() + 1) + '-' + p(nxt.getDate());
    window.__mvWear(niso);
    const modal = document.getElementById('rb-mv-wear');
    const tiles = modal ? modal.querySelectorAll('button[onclick*="__mvWearPick"]').length : 0;
    const head = modal ? modal.textContent : '';
    window.__mvWearPick(niso, 'lk-1');
    await new Promise((r) => setTimeout(r, 200));
    return {
      cellWired: !!cell || isMonthTail,
      hadModal: !!modal, tiles,
      asks: /Wear a look this day\?/.test(head),
      modalGone: !document.getElementById('rb-mv-wear'),
      today: iso, target: niso,
    };
  });
  check('IA · empty future days are wired to the wear-a-look door', wear.cellWired === true);
  check('IA · the door lists her looks and asks, never creates',
    wear.hadModal && wear.tiles === 2 && wear.asks, JSON.stringify(wear));
  await page.waitForTimeout(1200); // the planned_days write is debounced
  const calPin = writes.find((w) => w.method === 'POST' && /^planned_days/.test(w.url) &&
    Array.isArray(w.body) && w.body[0]?.source_type === 'look');
  check('IA · picking a look pins it to the day (planned_days, source_type look)',
    !!calPin && calPin.body[0]?.source_id === 'lk-1' && calPin.body[0]?.day_date === wear.target,
    JSON.stringify(calPin?.body?.[0] || null));

  // Bridges, not duplicates: a piece's edit form links into the Lookbook.
  await page.evaluate(() => window.__wtrkEdit && window.__wtrkEdit('w-top1'));
  await page.waitForTimeout(900);
  const bridge = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#wa-modal button'))
      .find((b) => /Styled in \d+ looks? →/.test(b.textContent));
    return { label: btn ? btn.textContent : null, had: !!btn };
  });
  check('IA · a piece\'s form shows the Styled-in-N-looks bridge',
    bridge.had && /Styled in 1 look →/.test(bridge.label || ''), JSON.stringify(bridge));
  const bridged = await page.evaluate(async () => {
    Array.from(document.querySelectorAll('#wa-modal button'))
      .find((b) => /Styled in \d+ looks? →/.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 700));
    return {
      modalClosed: !document.getElementById('wa-modal')?.classList.contains('open'),
      wrapShown: (() => { const el = document.getElementById('rb-lk-wrap'); return !!el && el.offsetParent !== null; })(),
    };
  });
  check('IA · the bridge closes the form and lands on the looks shelf',
    bridged.modalClosed && bridged.wrapShown, JSON.stringify(bridged));

  // Inspiration — the undated shelf. The key piece seeded above lives
  // there; Restyle re-arms the home prompt with the original ask.
  await page.evaluate(() => window.__rbNavGo('inspiration'));
  await page.waitForTimeout(500);
  const insp = await page.evaluate(() => ({
    open: document.getElementById('rb-insp-page')?.style.display === 'block',
    path: location.pathname,
    tnActive: document.getElementById('rb-tn-inspiration')?.classList.contains('active'),
    lookbookOff: !document.getElementById('rb-tn-lookbook')?.classList.contains('active'),
    cards: document.querySelectorAll('#rb-in-grid .rb-in-card').length,
    title: document.querySelector('#rb-in-grid .rb-in-title')?.textContent,
    sub: document.querySelector('#rb-in-grid .rb-in-sub')?.textContent,
    saveAsLook: /Save as look/i.test(document.getElementById('rb-in-grid')?.textContent || ''),
  }));
  check('IA · Inspiration is its own destination holding the key pieces',
    insp.open && insp.path === '/inspiration' && insp.tnActive === true && insp.lookbookOff === true
      && insp.cards === 1 && insp.title === 'Umbro shorts' && /Styled three ways by Robes/.test(insp.sub || ''),
    JSON.stringify(insp));
  check('IA · no Save-as-look yet (deferred — Annie 2026-08-10)', insp.saveAsLook === false);
  const restyled = await page.evaluate(async () => {
    document.querySelector('#rb-in-grid .rb-in-act').click();
    await new Promise((r) => setTimeout(r, 600));
    return {
      inspClosed: document.getElementById('rb-insp-page').style.display === 'none',
      prompt: document.getElementById('cb-ta')?.value || '',
    };
  });
  check('IA · Restyle lands on the home prompt with the ask re-armed',
    restyled.inspClosed && /Style my Umbro shorts three ways/.test(restyled.prompt), JSON.stringify(restyled));
  check('IA · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  await ctx.close();
}

// Zero looks: the empty-day door hands her to the Lookbook to make one.
{
  const { ctx, page, errs } = await boot(browser, { seed: false });
  await page.evaluate(() => window.__rbNavGo('calendar'));
  await page.waitForTimeout(700);
  const door = await page.evaluate(() => {
    const p = (n) => String(n).padStart(2, '0');
    const t = new Date(Date.now() + 86400000);
    window.__mvWear(t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()));
    const modal = document.getElementById('rb-mv-wear');
    const btn = modal && Array.from(modal.querySelectorAll('button')).find((b) => /Make one in the Lookbook/.test(b.textContent));
    const copy = modal ? /looks are made there, then worn here/.test(modal.textContent) : false;
    if (btn) btn.click();
    return { hadDoor: !!btn, copy };
  });
  await page.waitForTimeout(700);
  const landed = await page.evaluate(() => ({
    composer: !!document.getElementById('rb-lk-newtitle'),
    calOff: !document.getElementById('sn-page').classList.contains('rb-cal-on'),
  }));
  check('IA zero-looks · the calendar creates nothing — it hands to the Lookbook',
    door.hadDoor && door.copy, JSON.stringify(door));
  check('IA zero-looks · the door lands in the composer', landed.composer && landed.calOff, JSON.stringify(landed));
  check('IA zero-looks · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 9 · RULE 04 — a look made FOR A DAY is pinned to that date, and saving it
// to the Lookbook is OFFERED, never forced. Two different things, so two
// different writes: the day record lands on generation (the diary must not
// have a hole where she was dressed) and the Lookbook save mints a named
// Look, which is what starts gathering wear data (rule 03).
// Supersedes the 2026-08-13 deferral, which withheld both and lost the day.
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, writes } = await boot(browser, { seed: false, pics: 0 });
  const DL = {
    headline: 'A Dublin office look.',
    occasion_label: 'Office day',
    stylist_summary: 'Soft tailoring for a working day; flat leather keeps it moving.',
    look_tags: { climate: 'year_round', wear_for: ['work'], vibe: ['powerhouse'] },
    steps: [
      { title: 'The Canvas', items: [{ name: 'Fine merino knit', category: 'Tops', brand: 'COS', retailer_hint: 'COS', price_point: '€69' }] },
      { title: 'The Anchor', items: [{ name: 'Wide linen trousers', category: 'Bottoms', brand: 'Arket', retailer_hint: 'Arket', price_point: '€120' }] },
      { title: 'The Exclamation Point', items: [{ name: 'Leather loafers', category: 'Shoes', brand: 'Gucci', retailer_hint: 'Net-a-Porter', price_point: '€790' }] },
    ],
  };
  const rendered = await page.evaluate(async (data) => {
    // __dlSubmit stamps anchor_date before every real render — mirror it
    const p = (n) => String(n).padStart(2, '0');
    const t = new Date();
    data.anchor_date = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    window.__dlRenderResult(data, 'Style me for a day in the office');
    await new Promise((r) => setTimeout(r, 500));
    const head = document.querySelector('#dl-result-page header');
    return {
      eyebrow: head?.querySelector('.dlm-eyebrow')?.textContent,
      title: head?.querySelector('.dlm-title')?.textContent,
      wearing: head?.querySelector('.dlm-wearing')?.textContent,
      vibe: head?.querySelector('.dlm-vibe')?.textContent,
      vibeRead: head?.querySelector('.dlm-vibread')?.textContent.replace(/\s+/g, ' '),
      offer: head?.querySelector('.dlm-offer button')?.textContent,
      cta: document.querySelector('#dl-result-page .rbc-action button')?.textContent,
      wear: !!document.getElementById('dl-wear-btn'),
      card: getComputedStyle(document.querySelector('#dl-result-page .dlm-console')).backgroundColor,
      panelBorder: getComputedStyle(document.querySelector('#dl-result-page .rbc-panel')).borderTopStyle,
    };
  }, DL);
  await page.waitForTimeout(1200);   // the planned_days write is debounced
  check('rule 04 · the DAY is recorded on generation — the diary keeps no hole',
    writes.some((w) => w.method === 'POST' && /^lookbook_items/.test(w.url))
      && writes.some((w) => w.method === 'POST' && /^planned_days/.test(w.url)),
    JSON.stringify(writes.map((w) => w.method + ' ' + w.url).slice(-6)));
  check('rule 04 · but no Look is minted — that is hers to keep',
    !writes.some((w) => w.method === 'POST' && /^looks/.test(w.url)),
    JSON.stringify(writes.map((w) => w.url).slice(-6)));
  // E3 — the DAY is titled by its OCCASION, the date leads as the eyebrow,
  // and the look's own name sits in the line beneath.
  check('E3 · the day is titled by its occasion, dated in the eyebrow',
    rendered.title === 'Office day' && /^[A-Z][a-z]+day \d+ [A-Z]/.test(rendered.eyebrow || ''),
    JSON.stringify([rendered.eyebrow, rendered.title]));
  check('E3 · the look is named in the line beneath, never conflated with the day',
    /Wearing/.test(rendered.wearing || '') && /A Dublin office look/.test(rendered.wearing || ''),
    rendered.wearing);
  // E1 — Robes always shows which vibe it chose, and it is always editable.
  check('E1 · the vibe rides the day, and says it was read',
    rendered.vibe === 'Powerhouse' && /Robes read Powerhouse as the vibe/.test(rendered.vibeRead || '')
      && /Change the vibe/.test(rendered.vibeRead || ''),
    JSON.stringify([rendered.vibe, rendered.vibeRead]));
  check('rule 04 · the Lookbook save is an OFFER, and Share stays the day\'s action',
    rendered.offer === 'Save to your Lookbook' && rendered.cta === 'Share this look',
    JSON.stringify([rendered.offer, rendered.cta]));
  check('daily zero-owned · Wore it waits for a piece she owns', rendered.wear === false, JSON.stringify(rendered.wear));
  check('daily zero-owned · the console is held in the composer’s card, no frame in a frame',
    rendered.card === 'rgb(255, 255, 255)' && rendered.panelBorder === 'none', JSON.stringify([rendered.card, rendered.panelBorder]));

  const saved = await page.evaluate(async () => {
    window.__dlSaveAsk();
    await new Promise((r) => setTimeout(r, 250));
    const m = document.getElementById('rb-del-modal');
    const text = (m?.textContent || '').replace(/\s+/g, ' ');
    document.getElementById('rb-dlsave-yes')?.click();
    await new Promise((r) => setTimeout(r, 1000));
    const head = document.querySelector('#dl-result-page header');
    return {
      text,
      offer: !!head?.querySelector('.dlm-offer'),
      door: head?.querySelector('.dlm-lksrc')?.textContent.replace(/\s+/g, ' '),
    };
  });
  check('rule 04 · the offer says where the unowned pieces go, before it happens',
    /aren.t yours yet/.test(saved.text) && /Wishlist/.test(saved.text), saved.text.slice(0, 140));
  check('rule 04 · once kept, the offer retires and the day points at the look',
    saved.offer === false && /Saved in your Lookbook/.test(saved.door || ''), JSON.stringify(saved));
  check('rule 04 · the keep mints the Look and sends every proposal to the wishlist',
    writes.some((w) => w.method === 'POST' && /^looks/.test(w.url))
      && writes.filter((w) => w.method === 'POST' && /^wishlist_items/.test(w.url)).length === 3,
    JSON.stringify(writes.map((w) => w.method + ' ' + w.url).slice(-8)));
  check('daily zero-owned · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));

  // ── Made LOOSE (1a) — a look built around a piece, not for a day. It
  // opens in the builder, editable, writes NOTHING, and Save is the one
  // commitment. The flick cluster is absent on suggestions with no owned
  // peers — AI alternates never enter the flick set (Annie, 2026-08-17).
  const wBefore = writes.length;
  const loose = await page.evaluate(async () => {
    const data = {
      _dlLoose: true,
      headline: 'Built around the linen shirt.',
      occasion_label: '',
      stylist_summary: 'The shirt leads; everything else stays quiet.',
      steps: [
        { title: 'The Canvas', items: [{ name: 'White linen shirt', category: 'Tops', brand: 'Arket', retailer_hint: 'Arket', price_point: '€89',
            alternates: [{ name: 'Striped cotton shirt', brand: 'COS', retailer_hint: 'COS', price_point: '€79' }] }] },
        { title: 'The Anchor', items: [{ name: 'Camel wool coat', category: 'Outerwear', brand: 'Toteme', retailer_hint: 'Net-a-Porter', price_point: '€890',
            alternates: [{ name: 'Grey wool coat', brand: 'COS', retailer_hint: 'COS', price_point: '€290' }] }] },
      ],
    };
    window.__dlRenderResult(data, 'A look built around my linen shirt');
    await new Promise((r) => setTimeout(r, 500));
    const head = document.querySelector('#dl-result-page header');
    const rowOf = (name) => Array.from(document.querySelectorAll('#dl-result-page .rbc-row'))
      .find((r) => r.querySelector('.rbc-name')?.textContent === name);
    // Flick the shirt through its whole cycle — her own tops only, the
    // stored AI alternate must never surface.
    const seen = [];
    for (let k = 0; k < 4; k++) {
      window.__dlFlip(0, 1);
      await new Promise((r) => setTimeout(r, 120));
      seen.push(window.__dlCurrentItems[0].name);
    }
    return {
      coatArrows: rowOf('Camel wool coat') ? rowOf('Camel wool coat').querySelectorAll('.rbc-arrow').length : -1,
      shirtArrows: rowOf(window.__dlCurrentItems[0].name) ? 2 : 0,
      seen,
      eyebrow: head?.querySelector('.dlm-eyebrow')?.textContent,
      title: head?.querySelector('.dlm-title')?.textContent,
      wearing: !!head?.querySelector('.dlm-wearing'),
      offer: !!head?.querySelector('.dlm-offer'),
      dayPencil: !!head?.querySelector('[title="Name the day"]'),
      cta: document.querySelector('#dl-result-page .rbc-action button')?.textContent,
      keep: !!document.querySelector('#dl-result-page .rbc-action.keep'),
      panelHead: document.querySelector('#dl-result-page .rbc-lhead .lab')?.textContent,
      restyle: Array.from(document.querySelectorAll('#dl-result-page .rbc-hbtn')).map((x) => x.textContent).join('|'),
    };
  });
  await page.waitForTimeout(1000);
  const looseWrites = writes.slice(wBefore).map((w) => w.method + ' ' + w.url);
  check('loose · a look built around a piece writes NOTHING on render (1a)',
    !looseWrites.some((x) => /POST (lookbook_items|planned_days|looks)/.test(x)),
    JSON.stringify(looseWrites));
  check('loose · no day chrome — the look titles the page, Save is the commitment',
    loose.eyebrow === 'Your look' && loose.title === 'Built around the linen shirt.'
      && loose.wearing === false && loose.offer === false && loose.dayPencil === false
      && loose.cta === 'Save this look' && loose.keep === true
      && loose.panelHead === 'The look · 2 pieces' && /Restyle it/.test(loose.restyle),
    JSON.stringify(loose));
  // Both suggestions carry stored AI alternates. The shirt has owned peers
  // (her tops) so it flicks — through HER tops only, the alternate never
  // surfaces. The coat has no owned peers, so it has no flick at all: a
  // suggestion is only ever swapped for a piece she owns.
  check('flick · a suggestion with no owned peers has no cluster',
    loose.coatArrows === 0, String(loose.coatArrows));
  check('flick · a suggestion with owned peers cycles HER pieces only — never another suggestion',
    loose.seen.length === 4 && !loose.seen.includes('Striped cotton shirt')
      && loose.seen.includes('Cream silk shirt') && loose.seen.includes('White linen shirt'),
    JSON.stringify(loose.seen));

  const looseKept = await page.evaluate(async () => {
    window.__dlSaveAsk();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('rb-dlsave-yes')?.click();
    await new Promise((r) => setTimeout(r, 800));
    const head = document.querySelector('#dl-result-page header');
    return {
      cta: document.querySelector('#dl-result-page .rbc-action button')?.textContent,
      door: (head?.querySelector('.dlm-lksrc')?.textContent || '').replace(/\s+/g, ' '),
    };
  });
  await page.waitForTimeout(600);
  const keptWrites = writes.slice(wBefore).map((w) => w.method + ' ' + w.url);
  check('loose · keeping it mints the LOOK and nothing else — still no day record',
    keptWrites.some((x) => /POST looks/.test(x))
      && !keptWrites.some((x) => /POST (lookbook_items|planned_days)/.test(x)),
    JSON.stringify(keptWrites.slice(-6)));
  check('loose · once kept it is a saved look — Share returns, the door points at it',
    looseKept.cta === 'Share this look' && /Saved in your Lookbook/.test(looseKept.door),
    JSON.stringify(looseKept));
  // Guided landing (Annie's FTUE testing, 2026-08-19): the keep was the
  // console's one commitment — she is handed back to the dashboard.
  const landed = await page.evaluate(() => ({
    dlHidden: document.getElementById('dl-result-page')?.style.display === 'none',
    path: location.pathname,
  }));
  check('loose · the keep lands her back on the dashboard',
    landed.dlHidden === true && landed.path === '/dashboard', JSON.stringify(landed));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 10 · RULES 05 + 06 — a look pinned to a day, adjusted. Every change is
// local to the day and marked as such; the saved look is untouched. Robes
// asks ONCE, on marking it worn or on leaving: keep the changes here (the
// wear goes to the original look, recorded as adjusted) or save them as a
// new, named look (the wear goes to that one).
// ─────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, writes } = await boot(browser, { pics: 4 });
  await page.route('**res.cloudinary.com/**', (r) => r.abort());
  await openLooks(page);
  // lk-1 is a saved look of four pieces — open the day that wears it.
  const day = await page.evaluate(async () => {
    const p = (n) => String(n).padStart(2, '0');
    const t = new Date();
    const iso = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    window.__lkOpenAsDay({ source_id: 'lk-1', day_date: iso, activity: 'Board day' });
    await new Promise((r) => setTimeout(r, 500));
    const head = document.querySelector('#dl-result-page header');
    return {
      iso,
      title: head?.querySelector('.dlm-title')?.textContent,
      wearing: head?.querySelector('.dlm-wearing')?.textContent,
      banner: !!head?.querySelector('.dlm-adjusted'),
      rows: document.querySelectorAll('#dl-result-page .rbc-rack .rbc-row').length,
    };
  });
  check('rule 05 · the day opens on its own title, wearing the saved look',
    day.title === 'Board day' && /The Thursday one/.test(day.wearing || '') && day.rows === 4,
    JSON.stringify(day));
  check('rule 05 · an untouched day says nothing — the banner is for changes',
    day.banner === false, JSON.stringify(day));

  const adjusted = await page.evaluate(async () => {
    window.__dlFlip(0, 1);   // swap the first piece for another of hers
    await new Promise((r) => setTimeout(r, 400));
    const head = document.querySelector('#dl-result-page header');
    const local = document.querySelector('#dl-result-page .rbc-hownote.dl-local');
    return {
      banner: (head?.querySelector('.dlm-adjusted')?.textContent || '').replace(/\s+/g, ' '),
      chip: local?.querySelector('.dl-todayonly')?.textContent,
      localCopy: (local?.textContent || '').replace(/\s+/g, ' '),
      undo: !!local?.querySelector('button'),
      marked: document.querySelectorAll('#dl-result-page .rbc-row.dl-localrow').length,
      reset: !!head?.querySelector('.dlm-adjusted button.q'),
    };
  });
  check('rule 05 · one quiet line says the change is local, and names the untouched look',
    /One change on this day only/.test(adjusted.banner) && /The Thursday one/.test(adjusted.banner)
      && /is unchanged/.test(adjusted.banner),
    adjusted.banner.slice(0, 160));
  check('rule 05 · the changed row is marked Today only, names what it stands in for, and undoes',
    adjusted.chip === 'Today only' && /Swapped in for the/.test(adjusted.localCopy)
      && adjusted.undo === true && adjusted.marked === 1,
    JSON.stringify(adjusted));
  check('rule 05 · the banner offers both ways out — reset, or save as new',
    adjusted.reset === true && /Save as a new look/.test(adjusted.banner), adjusted.banner.slice(0, 160));
  check('rule 05 · the saved look itself is untouched',
    !writes.some((w) => w.method === 'DELETE' && /^look_pieces/.test(w.url)),
    JSON.stringify(writes.filter((w) => /look_pieces/.test(w.url)).map((w) => w.method + ' ' + w.url)));

  // RULE 06 — asked once, on marking it worn.
  const asked = await page.evaluate(async () => {
    window.__dlWear();
    await new Promise((r) => setTimeout(r, 400));
    const m = document.getElementById('rb-del-modal');
    const text = (m?.textContent || '').replace(/\s+/g, ' ');
    return {
      shown: !!m,
      text: text.slice(0, 160),
      suggested: m?.querySelector('#rb-dlnew-name')?.value,
      keep: !!Array.from(m?.querySelectorAll('button') || []).find((b) => b.textContent === 'Just keep it on the day'),
    };
  });
  check('rule 06 · marking it worn asks the one question, with a name ready',
    asked.shown === true && /You changed one piece/.test(asked.text)
      && /Save it as a new look/.test(asked.text) && !!asked.suggested && asked.keep === true,
    JSON.stringify(asked));

  const kept = await page.evaluate(async () => {
    Array.from(document.querySelectorAll('#rb-del-modal button'))
      .find((b) => b.textContent === 'Just keep it on the day').click();
    await new Promise((r) => setTimeout(r, 900));
    return { worn: document.getElementById('dl-wear-btn')?.textContent };
  });
  check('rule 06 · keeping it on the day logs the wear', /Worn/.test(kept.worn || ''), JSON.stringify(kept));
  await page.waitForTimeout(400);
  const wearWrite = writes.filter((w) => w.method === 'POST' && /^wears/.test(w.url)).pop();
  check('rule 06 · the wear goes to the ORIGINAL look, carrying what she actually wore',
    wearWrite?.body?.look_id === 'lk-1'
      && Array.isArray(wearWrite?.body?.piece_ids)
      && wearWrite.body.piece_ids.length === 4
      && !wearWrite.body.piece_ids.includes('w-top1'),
    JSON.stringify(wearWrite?.body || null));
  check('rule 06 · no second look was created by keeping it on the day',
    !writes.some((w) => w.method === 'POST' && /^looks/.test(w.url)),
    JSON.stringify(writes.filter((w) => /^looks/.test(w.url)).map((w) => w.method)));
  // …and the worn log names the difference rather than hiding it (1c).
  const log = await page.evaluate(async () => {
    window.__lkGo();
    window.__lkOpen('lk-1');
    await new Promise((r) => setTimeout(r, 300));
    const rows = Array.from(document.querySelectorAll('.rb-lk-wear')).map((r) => ({
      pc: (r.querySelector('.pc')?.textContent || '').replace(/\s+/g, ' '),
    }));
    return { rows, lineage: !!document.querySelector('.rb-lk-lin') };
  });
  check('1c · the worn log names the swap, adjusted on the day',
    log.rows.some((r) => /instead of the/.test(r.pc) && /adjusted on the day/.test(r.pc)),
    JSON.stringify(log.rows));

  // The other answer: save it as a new look. The variant carries lineage,
  // and the wear follows the look she named (rule 06).
  const promoted = await page.evaluate(async () => {
    const p = (n) => String(n).padStart(2, '0');
    const t = new Date(Date.now() + 86400000);
    const iso = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    window.__lkOpenAsDay({ source_id: 'lk-1', day_date: iso, activity: 'Board day' });
    await new Promise((r) => setTimeout(r, 500));
    window.__dlFlip(0, 1);
    await new Promise((r) => setTimeout(r, 300));
    window.__dlDayPromote();
    await new Promise((r) => setTimeout(r, 250));
    const inp = document.getElementById('rb-dlnew-name');
    if (inp) inp.value = 'The Thursday one, warmer';
    document.getElementById('rb-dlnew-yes')?.click();
    await new Promise((r) => setTimeout(r, 800));
    const head = document.querySelector('#dl-result-page header');
    return {
      banner: !!head?.querySelector('.dlm-adjusted'),
      door: head?.querySelector('.dlm-lksrc')?.textContent.replace(/\s+/g, ' '),
    };
  });
  await page.waitForTimeout(400);
  const newLook = writes.filter((w) => w.method === 'POST' && /^looks/.test(w.url)).pop();
  check('rule 06 · save-as-new writes a variant that names its ancestor',
    newLook?.body?.name === 'The Thursday one, warmer'
      && newLook?.body?.origin_look_id === 'lk-1'
      && newLook?.body?.source === 'variant',
    JSON.stringify(newLook?.body || null));
  check('rule 06 · the day now wears the new look, and reads settled again',
    promoted.banner === false && /Saved in your Lookbook/.test(promoted.door || ''),
    JSON.stringify(promoted));
  const lineage = await page.evaluate(async () => {
    window.__lkGo();
    window.__lkOpen('lk-1');
    await new Promise((r) => setTimeout(r, 300));
    return Array.from(document.querySelectorAll('.rb-lk-lin')).map((b) => b.textContent);
  });
  check('1c · both looks name each other — nothing is orphaned',
    lineage.includes('The Thursday one, warmer'), JSON.stringify(lineage));
  check('rules 05/06 · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  await ctx.close();
}

await browser.close();
server.kill();

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? '  ok ' : 'FAIL '} ${r.name}${r.pass ? '' : '  → ' + r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
