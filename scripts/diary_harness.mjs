// Diary harness — boots the real dashboard with Supabase + REST stubbed and
// walks the Diary as its own destination (Diary IA, 2026-09-08): the list
// view (default) fed by planned_days rows — invitations for the week ahead,
// the day card, the trip block with its header (title · dates · weather)
// and inline-named days, the quiet past — the List | Month toggle, the +
// menu, naming a bare day into the prompt, the empty state, and 390px.
// Run manually: npm i --no-save playwright && node scripts/diary_harness.mjs
// Set CHROME_PATH when playwright's bundled browser build isn't installed.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4327;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
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

const p2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const addD = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
const TODAY = addD(0);
// The fixture keeps to THIS month so every row lands in the visible list:
// the trip starts 2 days out, the daily look is tomorrow, the past is 5
// days back (a month boundary simply moves a row out of view, and the
// harness computes its expectations from the same rows).
const T0 = addD(2), T1 = addD(3), T2 = addD(4), TOM = addD(1), PAST = addD(-5);
const TRIP_ID = 1756900000000, DL_ID = 1756900000001, DL_PAST = 1756900000002;
const IMG = (i) => 'https://res.cloudinary.com/demo/image/upload/w' + i + '.jpg';
const PIECES = ['Cream silk shirt|Tops|Cream', 'Barrel-leg jeans|Bottoms|Navy', 'Flat leather sandals|Shoes|Camel', 'Woven straw tote|Bags|Cream', 'Gold hoops|Accessories|Ochre', 'Bias slip dress|Dresses|Blush']
  .map((s, i) => { const [label, category, color] = s.split('|'); return { id: 'w' + i, user_id: 'u-test', label, category, color, brand: 'Studio', notes: '', image_url: IMG(i), times_worn: i, item_dna: {}, hero_position: null, seasons: null, occasions: null, created_at: new Date(Date.now() - i * 1000).toISOString() }; });
const LOOKS = [
  { id: 'lk-1', user_id: 'u-test', name: 'The Thursday one', name_provisional: false, note: '', photo_url: null, source: 'wear', origin_look_id: null, created_at: '2026-07-20T10:00:00Z', updated_at: '2026-07-20T10:00:00Z' },
  { id: 'lk-2', user_id: 'u-test', name: 'Golf Club Dinner', name_provisional: false, note: '', photo_url: null, source: 'wear', origin_look_id: null, created_at: '2026-07-22T10:00:00Z', updated_at: '2026-07-22T10:00:00Z' },
];
const LP = [
  { look_id: 'lk-1', wardrobe_item_id: 'w0', slot: 'Top', position: 0 }, { look_id: 'lk-1', wardrobe_item_id: 'w1', slot: 'Bottom', position: 1 }, { look_id: 'lk-1', wardrobe_item_id: 'w2', slot: 'Shoe', position: 2 },
  { look_id: 'lk-2', wardrobe_item_id: 'w5', slot: 'Dress', position: 0 }, { look_id: 'lk-2', wardrobe_item_id: 'w2', slot: 'Shoe', position: 1 }, { look_id: 'lk-2', wardrobe_item_id: 'w4', slot: 'Accessory', position: 2 },
];
const PD = [
  { source_type: 'travel', source_id: String(TRIP_ID), day_index: 0, slot: 'day', day_date: T0, status: 'planned', activity: 'Travel and Dinner', headline: 'Golf Club Dinner', thumb_urls: [IMG(0)], item_ids: ['w0', 'w1'], pinned: false, updated_at: '2026-09-01T10:00:00Z' },
  { source_type: 'travel', source_id: String(TRIP_ID), day_index: 1, slot: 'day', day_date: T1, status: 'planned', activity: 'Watching golf, evening in the pub', headline: 'Pub Casual', thumb_urls: [IMG(1)], item_ids: ['w1', 'w2'], pinned: false, updated_at: '2026-09-01T10:00:00Z' },
  { source_type: 'travel', source_id: String(TRIP_ID), day_index: 2, slot: 'day', day_date: T2, status: 'planned', activity: 'Travel home', headline: null, thumb_urls: [], item_ids: [], pinned: false, updated_at: '2026-09-01T10:00:00Z' },
  { source_type: 'daily', source_id: String(DL_ID), day_index: 0, slot: 'day', day_date: TOM, status: 'planned', activity: 'Golf Club Event', headline: 'Daytime Nine', thumb_urls: [IMG(5)], item_ids: ['w5', 'w2', 'w4'], pinned: false, updated_at: '2026-09-02T10:00:00Z' },
  { source_type: 'daily', source_id: String(DL_PAST), day_index: 0, slot: 'day', day_date: PAST, status: 'worn', activity: 'The black one', headline: 'The black one', thumb_urls: [IMG(0)], item_ids: ['w0', 'w1', 'w2', 'w3'], pinned: false, updated_at: '2026-09-01T10:00:00Z' },
].map((r) => Object.assign({ user_id: 'u-test' }, r));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  → ' + String(detail).slice(0, 300) : '')); }
}

async function boot(browser, { width = 1280, seed = true, mode = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1100 } });
  const page = await ctx.newPage();
  const writes = [];
  await page.route('**cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA_STUB }));
  await page.route('**ayowpaknssulsqqvwpqx.supabase.co/**', (r) => {
    const req = r.request(); const u = req.url(); const m = req.method();
    if (m !== 'GET') {
      let body = null; try { body = req.postDataJSON(); } catch (_) { body = req.postData(); }
      writes.push({ method: m, url: u.split('/rest/v1/')[1] || u, body });
      return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    let body = '[]';
    if (u.includes('wardrobe_items')) body = JSON.stringify(PIECES);
    else if (u.includes('/looks')) body = JSON.stringify(LOOKS);
    else if (u.includes('look_pieces')) body = JSON.stringify(LP);
    else if (u.includes('planned_days')) body = JSON.stringify(seed ? PD : []);
    return r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.route('**nominatim**', (r) => r.abort());
  await page.route('**open-meteo**', (r) => r.abort());
  await page.route('**res.cloudinary.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#E3DDD0"/></svg>' }));
  await page.addInitScript(({ seed, T0, T2, TRIP_ID, DL_ID, DL_PAST, mode }) => {
    window.__TEST_PROFILE = { first_name: 'Annie', last_name: '', mobile: '', style_icons: [], budget: null, wardrobe_description: '', style_dna: {}, wardrobe_items_count: 6, onboarded_at: '2026-07-01', gender_identity: 'woman' };
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    if (mode) localStorage.setItem('rb_diary_mode', mode); else localStorage.removeItem('rb_diary_mode');
    if (seed) {
      const trip = { id: TRIP_ID, type: 'travel-edit', title: 'A trip to Lahinch.', subtitle: 'Lahinch, Ireland', img: null,
        tvData: { destination: 'Lahinch, Ireland', dateFrom: T0, dateTo: T2, dateLine: '', vibe: 'Chic golf vibe', brief: '', plans: [], dayTitles: { 0: 'Travel and Dinner', 1: 'Watching golf, evening in the pub', 2: 'Travel home' }, tripDays: 3,
          weather: { city: 'Lahinch', country: 'Ireland', tempRange: '13–19°C', condition: 'passing showers' },
          capsule: [{ name: 'Cream silk shirt', category: 'Tops', tier: 'keep', wardrobe_match: { id: 'w0', label: 'Cream silk shirt', image_url: 'https://res.cloudinary.com/demo/image/upload/w0.jpg' }, packed: true }, { name: 'Barrel-leg jeans', category: 'Bottoms', tier: 'keep', wardrobe_match: { id: 'w1', label: 'Barrel-leg jeans', image_url: 'https://res.cloudinary.com/demo/image/upload/w1.jpg' }, packed: true }],
          looks: [{ occasion: 'Golf Club Dinner', title: 'Golf Club Dinner', how: '', formula: [{ item_index: 0, role: 'The Canvas', note: '' }, { item_index: 1, role: 'The Anchor', note: '' }], pins: [0] }, { occasion: 'Pub Casual', title: 'Pub Casual', how: '', formula: [{ item_index: 1, role: 'The Anchor', note: '' }], pins: [1] }] } };
      const daily = { id: DL_ID, type: 'daily-look', title: 'Golf Club Event', subtitle: 'Daily look', img: null, dlData: { headline: 'Daytime Nine', occasion_label: 'Golf Club Event', steps: [], anchor_date: null } };
      const past = { id: DL_PAST, type: 'daily-look', title: 'The black one', subtitle: 'Daily look', img: null, dlData: { headline: 'The black one', occasion_label: 'The black one', steps: [], anchor_date: null, worn: true } };
      localStorage.setItem('robes_style_notes__u-test', JSON.stringify([trip, daily, past]));
    }
  }, { seed, T0, T2, TRIP_ID, DL_ID, DL_PAST, mode });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  return { ctx, page, errs, writes };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

// Expected invitations: today + the six days after, inside this month,
// minus the days something already holds (the daily look, the trip).
const held = new Set(PD.map((r) => r.day_date));
const monthOf = TODAY.slice(0, 7);
const expInvites = [0, 1, 2, 3, 4, 5, 6].map(addD).filter((d) => d.slice(0, 7) === monthOf && !held.has(d));
const inMonth = (d) => d.slice(0, 7) === monthOf;

// ─────────────────────────────────────────────────────────────────────────
// 1 · The list, seeded (1280)
{
  const { ctx, page, errs, writes } = await boot(browser);
  await page.evaluate(() => window.__rbNavGo('diary'));
  await page.waitForTimeout(900);
  const s = await page.evaluate(() => {
    const q = (sel, root) => (root || document).querySelector(sel);
    const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const trip = q('#sn-cal .dy-trip');
    return {
      path: location.pathname,
      eyebrow: q('#sn-eyebrow')?.textContent,
      diaryLit: q('#rb-tn-diary')?.classList.contains('active'),
      list: !!q('#sn-cal .dy-list'),
      grid: !!q('#sn-cal .rb-mv-cal'),
      segOn: qa('#sn-cal .rb-mv-seg button').map((b) => b.classList.contains('on')),
      nav: qa('#sn-cal .rb-mv-nav > button[aria-label]').map((b) => b.getAttribute('aria-label')),
      title: q('#sn-cal .rb-mv-title')?.textContent,
      invites: qa('#sn-cal .dy-row .dy-invite').map((el) => el.closest('.dy-row').dataset.date),
      invitePh: q('#sn-cal .dy-inv-in input')?.placeholder,
      past: qa('#sn-cal .dy-row.past').map((el) => ({ date: el.dataset.date, name: q('.dy-past-n', el)?.textContent, meta: q('.dy-past-m', el)?.textContent, worn: !!q('.dy-worn', el) })),
      card: (() => { const c = q('#sn-cal .dy-card'); if (!c) return null; return { date: c.closest('.dy-row').dataset.date, title: q('.dy-card-h h3', c)?.textContent, pen: !!q('.dy-pen', c), looks: qa('.dy-look', c).map((l) => q('.dy-look-n', l).textContent + ' · ' + q('.dy-look-m', l).textContent.trim()), add: q('.dy-addlook', c)?.textContent.trim() }; })(),
      trip: trip ? {
        title: q('.dy-trip-h h3', trip)?.textContent, range: q('.dy-trip-d', trip)?.textContent,
        wx: q('.dy-trip-wx span', trip)?.textContent, wxEm: q('.dy-trip-wx em', trip)?.textContent,
        days: qa('.dy-tday', trip).map((d) => ({ date: d.dataset.date, g: qa('.dy-g span', d).map((x) => x.textContent).join('|'), title: q('.dy-tday-t', d)?.textContent, looks: qa('.dy-look .dy-look-n', d).map((x) => x.textContent), add: !!q('.dy-tadd', d) })),
      } : null,
      tail: q('#sn-cal .dy-tail p')?.textContent, tailBtn: q('#sn-cal .dy-tail button')?.textContent,
      order: qa('#sn-cal .dy-list > .dy-row').map((r) => r.dataset.date || ('trip:' + r.dataset.trip)),
      cap: !!q('#sn-cal .rb-mv-cap'),
    };
  });
  check('list · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  check('list · the Diary opens at /diary, lit, on the LIST by default (no month grid, no caption)',
    s.path === '/diary' && s.eyebrow === 'Diary' && s.diaryLit === true && s.list === true && s.grid === false && s.cap === false
      && JSON.stringify(s.segOn) === JSON.stringify([true, false]), JSON.stringify([s.path, s.eyebrow, s.diaryLit, s.list, s.grid, s.segOn]));
  check('list · the header is the month, ‹ ›, the List | Month toggle and +',
    /\d{4}/.test(s.title || '') && JSON.stringify(s.nav) === JSON.stringify(['Previous month', 'Next month', 'Add']), JSON.stringify([s.title, s.nav]));
  check('list · today and the week ahead invite while empty ("Name the day" + the + door), nothing beyond',
    JSON.stringify(s.invites) === JSON.stringify(expInvites) && s.invitePh === 'Name the day', JSON.stringify([s.invites, expInvites, s.invitePh]));
  const pastExp = inMonth(PAST) ? [{ date: PAST, name: 'The black one', meta: 'Filed · 4 pieces', worn: true }] : [];
  check('list · the past files quietly: name, "Filed · N pieces", the Worn chip',
    JSON.stringify(s.past) === JSON.stringify(pastExp), JSON.stringify([s.past, pastExp]));
  if (inMonth(TOM)) {
    check('list · a dressed day is a card: her title, the pencil, its look with "N pieces", + Add a look',
      s.card && s.card.date === TOM && s.card.title === 'Golf Club Event' && s.card.pen === true
        && JSON.stringify(s.card.looks) === JSON.stringify(['Daytime Nine · 3 pieces']) && s.card.add === 'Add a look', JSON.stringify(s.card));
  }
  if (inMonth(T0)) {
    const tripDays = [T0, T1, T2].filter(inMonth);
    check('list · a trip is a block: title, dates, destination · temp · condition',
      s.trip && s.trip.title === 'A trip to Lahinch.' && /^\d+(–\d+)? [A-Z][a-z]{2}/.test(s.trip.range || '') && !/Sept/.test(s.trip.range || '')
        && /^Lahinch, Ireland · 13–19°C · passing showers$/.test(s.trip.wx || '') && s.trip.wxEm === 'passing showers', JSON.stringify(s.trip));
    check('list · the trip\'s days sit inside it: weekday / numeral / month gutter, her title in italic, the look, + Add on an undressed day',
      s.trip && JSON.stringify(s.trip.days.map((d) => d.date)) === JSON.stringify(tripDays)
        && s.trip.days[0].title === 'Travel and Dinner' && JSON.stringify(s.trip.days[0].looks) === JSON.stringify(['Golf Club Dinner']) && s.trip.days[0].add === false
        && /^[A-Z][a-z]{2}\|\d+\|[A-Z][a-z]{2}$/.test(s.trip.days[0].g) && !/Sept/.test(s.trip.days[0].g)
        && (tripDays.length < 3 || (s.trip.days[2].title === 'Travel home' && s.trip.days[2].looks.length === 0 && s.trip.days[2].add === true)),
      JSON.stringify(s.trip && s.trip.days));
    check('list · one row per date in order; the trip holds its dates (no invitations inside it)',
      s.order.indexOf('trip:' + TRIP_ID) >= 0 && !s.invites.some((d) => tripDays.includes(d)) && s.order.slice().every((v, i, a) => i === 0 || v.startsWith('trip:') || a[i - 1].startsWith('trip:') || v > a[i - 1]),
      JSON.stringify(s.order));
  }
  check('list · the tail says the rest of the month is unfiled and offers the next month',
    /^Nothing filed for the rest of [A-Z][a-z]+\.$/.test(s.tail || '') && /\d{4}/.test(s.tailBtn || ''), JSON.stringify([s.tail, s.tailBtn]));

  // Inline naming — trip day (writes tvData.dayTitles through the one path)
  if (inMonth(T0)) {
    const named = await page.evaluate(async () => {
      const day = document.querySelector('#sn-cal .dy-tday');
      day.querySelector('.dy-tday-t').click();
      await new Promise((r) => setTimeout(r, 120));
      const inp = document.getElementById('dy-name-in');
      if (!inp) return { inp: false };
      inp.value = 'Arrival supper';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const items = JSON.parse(localStorage.getItem('robes_style_notes__u-test') || '[]');
      const trip = items.find((i) => i.type === 'travel-edit');
      return { inp: true, stored: trip && trip.tvData.dayTitles[0], shown: document.querySelector('#sn-cal .dy-tday .dy-tday-t')?.textContent, inputGone: !document.getElementById('dy-name-in') };
    });
    check('list · a trip day renames inline, writing the trip\'s own day title',
      named.inp && named.stored === 'Arrival supper' && named.shown === 'Arrival supper' && named.inputGone, JSON.stringify(named));
  }
  if (inMonth(TOM)) {
    const renamed = await page.evaluate(async () => {
      document.querySelector('#sn-cal .dy-card .dy-pen').click();
      await new Promise((r) => setTimeout(r, 120));
      const inp = document.getElementById('dy-name-in');
      if (!inp) return { inp: false };
      inp.value = 'Club day';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const items = JSON.parse(localStorage.getItem('robes_style_notes__u-test') || '[]');
      const dl = items.find((i) => i.type === 'daily-look' && i.title === 'Golf Club Event');
      return { inp: true, stored: dl && dl.dlData.occasion_label, shown: document.querySelector('#sn-cal .dy-card-h h3')?.textContent };
    });
    check('list · a day card renames inline through the day\'s occasion (the one rename path)',
      renamed.inp && renamed.stored === 'Club day' && renamed.shown === 'Club day', JSON.stringify(renamed));
    // + Add a look opens the shared picker for THAT date
    const add = await page.evaluate(async (TOM) => {
      document.querySelector('#sn-cal .dy-card .dy-addlook').click();
      await new Promise((r) => setTimeout(r, 200));
      const m = document.getElementById('rb-mv-wear');
      const t = m ? m.textContent : '';
      m?.remove();
      const long = new Date(TOM + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
      return { had: !!m, dated: t.indexOf(long) >= 0 || t.indexOf(String(+TOM.slice(8, 10))) >= 0, robes: /Robes styles one/.test(t) };
    }, TOM);
    check('list · + Add a look opens the shared add-a-look picker for that date',
      add.had && add.dated && add.robes, JSON.stringify(add));
  }
  // The trip's undressed day: Add opens the trip on that day
  if (inMonth(T2)) {
    const opened = await page.evaluate(async () => {
      const btn = document.querySelector('#sn-cal .dy-tday .dy-tadd');
      btn.click();
      await new Promise((r) => setTimeout(r, 900));
      const tv = document.getElementById('tv-result-page');
      const r = { tvOpen: !!tv && tv.style.display !== 'none', diaryLit: document.getElementById('rb-tn-diary')?.classList.contains('active'), snHidden: document.getElementById('sn-page')?.style.display === 'none' };
      window.__tvGoBack();
      await new Promise((r2) => setTimeout(r2, 500));
      r.backList = !!document.querySelector('#sn-cal .dy-list');
      return r;
    });
    check('list · "+ Add" on a trip day opens the trip (Diary lit), and back returns to the list',
      opened.tvOpen && opened.diaryLit === true && opened.snHidden && opened.backList, JSON.stringify(opened));
  }
  // The + on an invitation is a dated menu
  if (expInvites.length) {
    const menu = await page.evaluate(async (d) => {
      const row = document.querySelector('#sn-cal .dy-row[data-date="' + d + '"] .dy-inv-add');
      row.click();
      await new Promise((r) => setTimeout(r, 100));
      const m = document.getElementById('rb-dy-addmenu');
      const opts = m ? Array.from(m.querySelectorAll('.card button .t')).map((b) => b.textContent) : [];
      const lookBtn = m && m.querySelector('.card button');
      lookBtn && lookBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      const w = document.getElementById('rb-mv-wear');
      const t = w ? w.textContent : '';
      w?.remove();
      return { opts, picker: !!w, dated: t.indexOf(String(+d.slice(8, 10))) >= 0 };
    }, expInvites[0]);
    check('list · the invitation\'s + offers Add a look / Add a travel edit, dated to that day',
      JSON.stringify(menu.opts) === JSON.stringify(['Add a look', 'Add a travel edit']) && menu.picker && menu.dated, JSON.stringify(menu));
    // Naming a bare day is the standing rule: her words go to the prompt, scoped to the date
    const named = await page.evaluate(async (d) => {
      const inp = document.querySelector('#sn-cal .dy-row[data-date="' + d + '"] .dy-inv-in input');
      inp.value = 'Dinner with mum';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return {
        diaryClosed: document.getElementById('sn-page')?.style.display === 'none',
        prompt: document.getElementById('cb-ta')?.value,
        chip: document.getElementById('rb-scopechip')?.textContent || '',
        path: location.pathname,
      };
    }, expInvites[0]);
    check('list · naming a bare day lands her words in the prompt, scoped to that day',
      named.diaryClosed && named.prompt === 'Dinner with mum' && named.chip.length > 0 && named.path === '/dashboard', JSON.stringify(named));
  }
  // Month is one toggle away, remembered per device
  await page.evaluate(() => window.__rbNavGo('diary'));
  await page.waitForTimeout(500);
  const month = await page.evaluate(async () => {
    window.__dySetMode('month');
    await new Promise((r) => setTimeout(r, 150));
    const r = {
      grid: !!document.querySelector('#sn-cal .rb-mv-cal'), list: !!document.querySelector('#sn-cal .dy-list'),
      cap: document.querySelector('#sn-cal .rb-mv-cap')?.textContent, segOn: Array.from(document.querySelectorAll('#sn-cal .rb-mv-seg button')).map((b) => b.classList.contains('on')),
      stored: localStorage.getItem('rb_diary_mode'),
    };
    window.__rbNavGo('lookbook'); await new Promise((r2) => setTimeout(r2, 300));
    window.__rbNavGo('diary'); await new Promise((r2) => setTimeout(r2, 500));
    r.stillMonth = !!document.querySelector('#sn-cal .rb-mv-cal');
    window.__dySetMode('list'); await new Promise((r2) => setTimeout(r2, 150));
    r.backToList = !!document.querySelector('#sn-cal .dy-list');
    return r;
  });
  check('list · Month is one toggle away, captioned, and remembered per device',
    month.grid && !month.list && month.cap === 'Month reads the shape of it. List is where you plan.' && JSON.stringify(month.segOn) === JSON.stringify([false, true])
      && month.stored === 'month' && month.stillMonth && month.backToList, JSON.stringify(month));
  check('list · no page errors after the walk', errs.length === 0, errs.join(' | ').slice(0, 240));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 2 · Empty (nothing planned this month)
{
  const { ctx, page, errs } = await boot(browser, { seed: false });
  await page.evaluate(() => window.__rbNavGo('diary'));
  await page.waitForTimeout(900);
  const e = await page.evaluate(async () => {
    const em = document.querySelector('#sn-cal .dy-empty');
    const r = {
      had: !!em, h: em?.querySelector('h3')?.textContent, p: em?.querySelector('p')?.textContent, cta: em?.querySelector('.dy-empty-cta')?.textContent,
      invites: document.querySelectorAll('#sn-cal .dy-invite').length,
      darkFills: Array.from(document.querySelectorAll('#sn-cal button')).filter((b) => getComputedStyle(b).backgroundColor === 'rgb(32, 32, 33)').length,
    };
    em?.querySelector('.dy-empty-cta')?.click();
    await new Promise((r2) => setTimeout(r2, 200));
    r.intake = !!document.getElementById('tv-brief-modal');
    r.diaryStill = document.getElementById('sn-page')?.style.display === 'block';
    document.getElementById('tv-brief-modal')?.remove();
    return r;
  });
  const expEmptyInvites = [0, 1, 2, 3, 4, 5, 6].map(addD).filter(inMonth).length;
  check('empty · the design\'s empty state: "Nothing planned yet.", the line, Plan a trip',
    e.had && /Nothing planned/.test(e.h || '') && /yet\./.test(e.h || '') && /The diary keeps the dates; the lookbook keeps the looks\./.test(e.p || '') && e.cta === 'Plan a trip', JSON.stringify(e));
  check('empty · Plan a trip is the ONE dark fill and opens the travel intake over the Diary',
    e.darkFills === 2 /* the CTA + the active List toggle */ && e.intake && e.diaryStill, JSON.stringify(e));
  check('empty · the week\'s invitations still follow beneath', e.invites === expEmptyInvites, JSON.stringify([e.invites, expEmptyInvites]));
  check('empty · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 3 · 390px
{
  const { ctx, page, errs } = await boot(browser, { width: 390 });
  await page.evaluate(() => window.__rbNavGo('diary'));
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => {
    const sn = document.getElementById('sn-page');
    const inv = document.querySelector('#sn-cal .dy-invite');
    const trip = document.querySelector('#sn-cal .dy-trip');
    return {
      list: !!document.querySelector('#sn-cal .dy-list'),
      noOverflow: sn.scrollWidth <= sn.clientWidth + 1,
      inviteFits: inv ? inv.getBoundingClientRect().right <= 390 : true,
      tripFits: trip ? trip.getBoundingClientRect().right <= 390 : true,
      dock: document.getElementById('rb-dock-diary')?.classList.contains('active'),
      addTap: (() => { const b = document.querySelector('#sn-cal .dy-inv-add'); return b ? b.getBoundingClientRect().width >= 44 : true; })(),
    };
  });
  check('390px · the list renders one column wide with no horizontal overflow; the dock lights Diary',
    m.list && m.noOverflow && m.inviteFits && m.tripFits && m.dock === true && m.addTap, JSON.stringify(m));
  check('390px · no page errors', errs.length === 0, errs.join(' | ').slice(0, 240));
  await ctx.close();
}

await browser.close();
server.kill();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
