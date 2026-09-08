// Travel console smoke — the one-scroll Travel Edit with the ONE-STAGE
// detail surface (mocks 2026-08-10). Boots the real dashboard (Supabase
// stubbed), feeds __tvRenderResult a looks-first fixture and walks: the
// one-scroll sections (masthead + Edit details, THE WEEK, LOOKS grid,
// THE CAPSULE drawer), the single stage (pinned looks open as their
// day, unpinned lead with the Pin-to-a-day bar), day-plan title
// editing, the day "+ Look" pin sheet, the Day/Evening switcher, the
// scoped flick + badge, imported-look capsule join, looks collapse,
// the pack stat on the capsule bar, the empty canvas trip,
// Edit-details clamping, legacy-save migration and the mobile sheet.
// Run manually: npm i --no-save playwright && node scripts/travel_console_smoke.mjs
// Set CHROME_PATH when playwright's bundled browser build isn't installed.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4327;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res) => {
  const on = (b) => { if (String(b).includes(String(PORT))) res(); };
  server.stdout.on('data', on); server.stderr.on('data', on);
  setTimeout(res, 2500);
});

const SUPA_STUB = `
window.supabase = { createClient(){
  const sess = { user: { id: 'u-test', email: 't@t.co' }, access_token: 'tok' };
  const q = () => ({ select(){ return this; }, eq(){ return this; }, order(){ return this; },
    single(){ return Promise.resolve({ data: window.__TEST_PROFILE, error: null }); },
    then(r){ return Promise.resolve({ data: [], error: null }).then(r); } });
  return { auth: { onAuthStateChange(){ return { data: { subscription: { unsubscribe(){} } } }; },
    getSession(){ return Promise.resolve({ data: { session: sess } }); }, signOut(){ return Promise.resolve({}); } },
    from(){ return q(); } };
} };`;

const WARDROBE = [
  { id: 'w1', label: 'Cream silk shirt', category: 'Tops', color: 'Cream' },
  { id: 'w2', label: 'Ribbed white tank', category: 'Tops', color: 'White' },
  { id: 'w3', label: 'Barrel-leg jeans', category: 'Bottoms', color: 'Navy' },
  { id: 'w4', label: 'Flat leather sandals', category: 'Shoes', color: 'Camel' },
  { id: 'w5', label: 'Tan leather slides', category: 'Shoes', color: 'Camel' },
].map((p, i) => ({ ...p, user_id: 'u-test', brand: 'Studio', notes: '', image_url: null, times_worn: 0, item_dna: {}, hero_position: null, seasons: null, occasions: null, created_at: new Date(Date.now() - i * 1000).toISOString() }));

const FIXTURE = {
  trip_label: 'LAHINCH · JULY', headline: 'A long weekend in Lahinch', location_vibe: 'Wild Atlantic ease',
  stylist_summary: 'A tight case for the coast.', suitcase_note: '', palette: ['#8A8078', '#C9BCA6'],
  destination: 'Lahinch', dateFrom: '2026-07-31', dateTo: '2026-08-03', dateLine: '31 Jul – 3 Aug',
  tripDays: 4, plans: ['Night out', 'Beach day'], vibe: 'Chic, cool',
  weather: { city: 'Lahinch', tempRange: '14–19°C', condition: 'passing showers' },
  dayTitles: { 0: 'Arrive · coastal walk' },
  capsule: [
    { name: 'Cream silk shirt', tier: 'Foundations & Tailoring', category: 'Tops', brand: 'Studio', description: '', reason: '', wardrobe_index: 0, retailer_hint: '', price_point: '', wardrobe_match: { id: 'w1', label: 'Cream silk shirt', image_url: null, color: 'Cream' } },
    { name: 'Ribbed white tank', tier: 'Foundations & Tailoring', category: 'Tops', brand: 'Studio', description: '', reason: '', wardrobe_index: 1, retailer_hint: '', price_point: '', wardrobe_match: { id: 'w2', label: 'Ribbed white tank', image_url: null, color: 'White' } },
    { name: 'Barrel-leg jeans', tier: 'Foundations & Tailoring', category: 'Bottoms', brand: 'Studio', description: '', reason: '', wardrobe_index: 2, retailer_hint: '', price_point: '', wardrobe_match: { id: 'w3', label: 'Barrel-leg jeans', image_url: null, color: 'Navy' } },
    { name: 'Flat leather sandals', tier: 'The Hardware', category: 'Shoes', brand: 'Studio', description: '', reason: '', wardrobe_index: 3, retailer_hint: '', price_point: '', wardrobe_match: { id: 'w4', label: 'Flat leather sandals', image_url: null, color: 'Camel' } },
    { name: 'Tan leather slides', tier: 'The Hardware', category: 'Shoes', brand: 'Studio', description: '', reason: '', wardrobe_index: 4, retailer_hint: '', price_point: '', wardrobe_match: { id: 'w5', label: 'Tan leather slides', image_url: null, color: 'Camel' } },
    { name: 'Storm shell jacket', tier: 'The Hardware', category: 'Outerwear', brand: 'Arket', description: '', reason: '', wardrobe_index: -1, retailer_hint: 'Arket', price_point: '€180' },
  ],
  left_behind: [],
  looks: [
    { occasion: 'Night out', title: 'Coast after dark', how: 'Silk over denim, slides for the walk back.', pins: [0, 1], overrides: {}, slotOverrides: {},
      formula: [ { role: 'The Anchor', item_index: 0, note: 'Worn open over the tank' }, { role: 'The Canvas', item_index: 2, note: 'Rolled once at the hem' }, { role: 'The Exclamation Point', item_index: 4, note: 'Bare ankle, gold hardware' } ] },
    { occasion: 'Beach day', title: 'Tide-line morning', how: 'The tank and jeans, sandals in hand.', pins: [0], overrides: {}, slotOverrides: {},
      formula: [ { role: 'The Anchor', item_index: 1, note: 'Tucked loosely' }, { role: 'The Canvas', item_index: 2, note: 'Cuffed to the shin' }, { role: 'The Exclamation Point', item_index: 3, note: 'Off more than on' } ] },
    { imported: true, lookId: 'lk-9', occasion: 'Dinner out', title: 'The Thursday one', how: '', img: null, pins: [1], overrides: {}, slotOverrides: {},
      pieces: [ { id: 'w1', name: 'Cream silk shirt', image: null, category: 'Tops' }, { id: 'w3', name: 'Barrel-leg jeans', image: null, category: 'Bottoms' }, { id: 'w9', name: 'Gold hoops', image: null, category: 'Accessories' } ], formula: [] },
  ],
};

const EMPTY_TRIP = {
  headline: 'A trip to Ibiza.', destination: 'Ibiza', dateFrom: '2026-09-01', dateTo: '2026-09-05',
  dateLine: '1 Sep – 5 Sep', tripDays: 5, vibe: 'Paula’s Ibiza', plans: [], dayTitles: {},
  capsule: [], looks: [], palette: [],
};

const LEGACY = {
  trip_label: 'IBIZA · MAY', headline: 'Ibiza, the old way.', location_vibe: '', stylist_summary: '', suitcase_note: '',
  palette: [], destination: 'Ibiza', dateFrom: '2026-05-04', dateTo: '2026-05-06', dateLine: '4 – 6 May',
  capsule: FIXTURE.capsule.slice(0, 5), left_behind: [],
  days: [
    { day_label: 'Day 1 · Arrival', slots: [ { slot: 'Day', title: 'Landing look', how: '', formula: [{ role: 'The Anchor', item_index: 0, note: '' }, { role: 'The Canvas', item_index: 2, note: '' }] },
      { slot: 'Evening', title: 'First dinner', how: '', formula: [{ role: 'The Anchor', item_index: 1, note: '' }, { role: 'The Exclamation Point', item_index: 4, note: '' }] } ] },
  ],
};

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.route('**cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA_STUB }));
await page.route('**ayowpaknssulsqqvwpqx.supabase.co/**', (r) => {
  const u = r.request().url(); const m = r.request().method();
  if (m !== 'GET') return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  let body = '[]';
  if (u.includes('wardrobe_items')) body = JSON.stringify(WARDROBE);
  return r.fulfill({ status: 200, contentType: 'application/json', body });
});
await page.route('**nominatim**', (r) => r.abort());
await page.route('**open-meteo**', (r) => r.abort());
await page.addInitScript(() => {
  window.__TEST_PROFILE = { first_name: 'Annie', style_icons: [], style_dna: {}, wardrobe_items_count: 5, onboarded_at: '2026-07-01', gender_identity: 'woman' };
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
});

await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.__tvRenderResult === 'function', null, { timeout: 15000 });
await page.waitForTimeout(800);

// ── 1. One-scroll render ──
await page.evaluate((fx) => window.__tvRenderResult(fx), FIXTURE);
await page.waitForTimeout(300);
ok(await page.locator('#tv-result-page .tvm-seg').count() === 0, 'no tab segment — the page is one scroll');
ok(await page.locator('#tv-sec-week').isVisible() && await page.locator('#tv-sec-looks').isVisible() && await page.locator('#tv-sec-capsule').isVisible(), 'week, looks and capsule sections all on one page');
ok((await page.locator('#tv-headline').innerText()).includes('A long weekend in Lahinch'), 'title renders');
ok(await page.locator('#tv-result-page .tvm-editbtn[aria-label="Edit details"]').count() === 1 && await page.locator('#tv-result-page .tvm-mast .rb-rename-tbtn').count() === 1, 'ONE pen on the masthead opens Edit details (the title rename pencil retired, Annie 2026-09-08)');
ok((await page.locator('#tv-mastmeta').innerText()).includes('Chic, cool'), 'vibe pill renders');
ok(await page.locator('#tv-weekstrip .tvw-card').count() === 4, 'week strip has one card per trip day');
ok(await page.evaluate(() => getComputedStyle(document.getElementById('tv-weekstrip')).flexWrap) !== 'wrap', 'week strip stays on one line (scrolls, never wraps)');
ok((await page.locator('#tv-weekstrip .tvw-card').first().innerText()).includes('Arrive · coastal walk'), 'day title renders on its card');
ok(await page.locator('#tv-stage .rbc-panel').count() === 0, 'nothing on the stage until something is tapped');
// Audit 8.3 (2026-08-19): the empty stage no longer holds a dashed box —
// the whole section stands down until a day or look is tapped.
ok(await page.evaluate(() => getComputedStyle(document.getElementById('tv-sec-stage')).display === 'none'), 'the stage section is hidden while empty');
ok(await page.locator('#tv-looksrow .tvm-lookcard').count() === 3, 'looks grid: 3 looks, all within the first row');
ok(await page.locator('#tv-looksrow .tvm-lookadd').count() === 0, 'no + New Look tile — adding lives on the header button');
ok(await page.locator('#tv-looks-more button').count() === 0, 'no expand toggle when one row holds everything');
ok((await page.locator('#tv-looksrow').innerText()).includes('Fri 31 · Sat 1'), 'a pinned look card reads its days');
ok((await page.locator('#tv-looksrow').innerText()).includes('unpinned') === false, 'every fixture look is pinned');

// capsule bar: pack stat lives on the pieces. The imported look's
// unowned piece (Gold hoops) joined the case at render, so 6 → 7.
ok(/7 pieces/i.test(await page.locator('#tv-cap-lab').innerText()), 'capsule bar counts the pieces (import joined the case)');
ok((await page.locator('#tv-mp-of').innerText()).includes('/ 6 packed'), 'packed denominator counts packable pieces');
ok(await page.locator('#tv-capbody').isVisible(), 'capsule drawer open by default on desktop');
ok((await page.locator('#tv-capbody').innerText()).includes('Keep'), 'Keep section renders in the drawer');
ok((await page.locator('#tv-capbody').innerText()).includes('Worth adding'), 'Worth adding renders in the drawer');
ok(await page.locator('#tv-capbody .tv-pack-box').count() === 6, 'a pack checkbox on every packable piece');
await page.evaluate(() => window.__tvPackToggle(0));
await page.waitForTimeout(150);
ok((await page.locator('#tv-mp-n').innerText()) === '1', 'packing a piece moves the bar stat');
await page.evaluate(() => window.__tvPackToggle(0));

// drawer folds
await page.evaluate(() => window.__tvCapToggle());
await page.waitForTimeout(100);
ok(!(await page.locator('#tv-capbody').isVisible()), 'capsule drawer folds');
await page.evaluate(() => window.__tvCapToggle());

// ── 2. One stage: a pinned look card opens AS ITS DAY ──
await page.evaluate(() => window.__tvSelectLook(0));
await page.waitForTimeout(200);
ok(await page.locator('#tv-stage .rbc-panel').count() === 1, 'the stage draws The Look panel');
ok(await page.locator('#tv-stage .tv-daybox').count() === 1, 'the stage panel sits in its container');
ok(await page.locator('#tv-stage .rbc-row').count() === 3, 'stage rack has 3 rows');
ok((await page.locator('#tv-stage .rbc-rackhead').innerText()).toLowerCase().includes('day 1'), 'a pinned look opens day-scoped — the rack carries its day');
ok(await page.locator('#tv-stage .rbc-hbtn', { hasText: 'Unpin from this day' }).count() === 1, 'pinned: the rack header carries Unpin');
ok(await page.locator('#tv-weekstrip .tvw-card.sel').count() === 1, 'the rail outlines the day on stage');
ok(await page.locator('#tv-looksrow .tvm-lookcard.active').count() === 1, 'the staged card carries the highlight');
await page.evaluate(() => window.__tvStageClose());
await page.waitForTimeout(150);
ok(await page.evaluate(() => getComputedStyle(document.getElementById('tv-sec-stage')).display === 'none'), 'Clear hides the stage section');
ok(await page.locator('#tv-stage .rbc-hbtn', { hasText: 'Pin to days' }).count() === 0, 'no duplicated Pin-to-days CTA anywhere');

// select the imported look → the SAME interactive console, pieces resolved
// into real capsule formula entries (unpacked pieces join the case)
await page.evaluate(() => window.__tvSelectLook(2));
await page.waitForTimeout(150);
ok(await page.locator('#tv-stage .rbc-panel').count() === 1, 'imported look draws the same console');
ok(await page.locator('#tv-stage .rbc-row').count() === 3, 'imported rack has 3 rows');
const impState = await page.evaluate(() => ({
  cap: window.__lastTvData.capsule.length,
  formula: window.__lastTvData.looks[2].formula.map(f => f.item_index),
  hoops: window.__lastTvData.capsule.some(c => c.name === 'Gold hoops' && c.wardrobe_match),
}));
ok(impState.cap === 7, 'unpacked piece joined the case');
ok(impState.formula.length === 3 && impState.formula[0] === 0 && impState.formula[1] === 2, 'pieces resolved to capsule indexes');
ok(impState.hoops, 'joined piece keeps its wardrobe identity');
ok(await page.locator('#tv-stage .rbc-hbtn', { hasText: 'Pack this look' }).count() === 1, 'imported look can be packed');

// ── 3. Day console + multi-look switcher ──
await page.evaluate(() => window.__tvSelectDay(0));
await page.waitForTimeout(200);
ok(await page.locator('#tv-weekstrip .tvw-card.sel').count() === 1, 'selected day card carries the ink ring');
ok(await page.locator('#tv-stage .rbc-panel').count() === 1, 'day console draws The Look panel');
ok(await page.locator('#tv-stage .tv-daybox').count() === 1, 'day console sits in its container');
const segTxt = await page.locator('#tv-stage').innerText();
ok(segTxt.includes('EVENING') && !segTxt.includes('EVENING · FREE'), 'two pinned looks read as the Day / Evening pair');
ok(await page.locator('#tv-stage .rbc-hbtn', { hasText: 'Unpin from this day' }).count() === 1, 'day head has Unpin');
await page.evaluate(() => window.__tvDaySetLook(1));
await page.waitForTimeout(150);
ok((await page.locator('#tv-stage .rbc-rackhead').innerText()).includes('Tide-line morning'), 'switcher swaps to the second look');

// ── 4. Scoped flick from the day console ──
await page.evaluate(() => window.__tvDaySetLook(0));
await page.waitForTimeout(120);
await page.locator('#tv-stage .rbc-row').nth(2).locator('.rbc-arrow').nth(1).click();
await page.waitForTimeout(200);
const ovr = await page.evaluate(() => JSON.parse(JSON.stringify(window.__lastTvData.looks[0].overrides || {})));
ok(ovr['0'] && Number.isInteger(ovr['0']['2']), 'day flick writes a Day-1-only override');
ok((await page.locator('#tv-stage').innerText()).toLowerCase().includes('swapped for day 1 only'), 'scope badge renders');
const day2Clean = await page.evaluate(() => !window.__lastTvData.looks[0].overrides[1]);
ok(day2Clean, 'the other pinned day is untouched');
// a pinned look card re-opens as its day — the badge shows there
await page.evaluate(() => window.__tvSelectLook(0));
await page.waitForTimeout(150);
ok((await page.locator('#tv-stage').innerText()).toLowerCase().includes('swapped for day 1 only'), 'reopening the pinned look lands on its day, badge intact');

// ── 4b. The worked example: Look 01 pinned to Day 1 + Day 2. Day 2 adds
// a piece and Day 1 drops one — each day's wear is its own, the look stays
// ONE look.
await page.evaluate(() => window.__tvSelectDay(1));
await page.waitForTimeout(150);
await page.evaluate(() => window.__tvDayConAddApply('w2'));
await page.waitForTimeout(200);
const wex = await page.evaluate(() => ({
  adds: JSON.parse(JSON.stringify(window.__lastTvData.looks[0].dayAdds || {})),
  rows: document.querySelectorAll('#tv-stage .rbc-row').length,
}));
ok(Array.isArray(wex.adds['1']) && wex.adds['1'].length === 1, 'day add lands in dayAdds for Day 2 only');
ok(wex.rows === 4, 'Day 2 rack shows the added piece');
ok((await page.locator('#tv-stage').innerText()).toLowerCase().includes('added for day 2 only'), 'added piece carries its day badge');
await page.evaluate(() => window.__tvSelectDay(0));
await page.waitForTimeout(150);
ok(await page.locator('#tv-stage .rbc-row').count() === 3, 'Day 1 keeps 3 pieces — one look, two wears');
await page.evaluate(() => window.__tvDayConRemove(0));
await page.waitForTimeout(200);
const drops = await page.evaluate(() => JSON.parse(JSON.stringify(window.__lastTvData.looks[0].dayDrops || {})));
ok(Array.isArray(drops['0']) && drops['0'][0] === 0, 'day remove registers a Day-1-only drop');
ok(await page.locator('#tv-stage .rbc-row').count() === 2, 'Day 1 rack loses the piece');
await page.evaluate(() => window.__tvSelectDay(1));
await page.waitForTimeout(150);
ok(await page.locator('#tv-stage .rbc-row').count() === 4, 'Day 2 still wears it');
// Look scope: an UNPINNED look opens look-scoped — an add reaches every
// future pinned day; a remove remaps the fi-keyed overrides down.
await page.evaluate(() => window.__tvUnpin(1, 0));
await page.evaluate(() => window.__tvSelectLook(1));
await page.waitForTimeout(150);
ok(await page.locator('#tv-stage .tvm-pinbar').count() === 1, 'an unpinned look leads with the Pin-to-a-day bar');
ok((await page.locator('#tv-stage .tvm-pinbar').innerText()).toLowerCase().includes('free'), 'the bar names the free days');
await page.evaluate(() => window.__tvLookConAddApply('w1'));
await page.waitForTimeout(200);
ok(await page.evaluate(() => window.__lastTvData.looks[1].formula.length) === 4, 'look-scope add grows the formula everywhere');
const remap = await page.evaluate(() => {
  const l = window.__lastTvData.looks[1];
  l.slotOverrides = { 2: 4 };
  window.__tvLookConRemove(0);
  return JSON.parse(JSON.stringify(l.slotOverrides));
});
ok(Object.keys(remap).length === 1 && remap['1'] === 4, 'look-scope remove remaps overrides down');

// ── 5. Free day invitation ──
await page.evaluate(() => window.__tvSelectDay(3));
await page.waitForTimeout(150);
const freeTxt = await page.locator('#tv-stage').innerText();
ok(/left free/.test(freeTxt), 'free day reads left free');
ok(/style a look for this day/i.test(freeTxt), 'free day offers styling');

// ── 6. Day-plan titles: name the day, then pin a look ──
ok((await page.locator('#tv-weekstrip .tvw-card').nth(3).innerText()).includes('name the day and add a look'), 'a bare day invites naming');
await page.evaluate(() => window.__tvDayTitleEdit(3));
await page.waitForTimeout(120);
ok(await page.locator('#tv-daytitle-in').count() === 1, 'title edit opens the inline input');
await page.evaluate(() => { document.getElementById('tv-daytitle-in').value = 'Drive · dinner out'; });
await page.evaluate(() => window.__tvDayTitleCommit(3));
await page.waitForTimeout(150);
ok(await page.evaluate(() => window.__lastTvData.dayTitles[3]) === 'Drive · dinner out', 'the title lands in dayTitles');
const day3Card = page.locator('#tv-weekstrip .tvw-card').nth(3);
ok((await day3Card.innerText()).includes('Drive · dinner out'), 'the day card shows her words');
ok(await day3Card.locator('.tvw-pin').count() === 1, 'a named day earns the + Look door');
await page.evaluate(() => window.__tvDayPick(3));
await page.waitForTimeout(150);
ok(await page.locator('#tv-daypick-modal').count() === 1, 'the + Look sheet opens');
const pickTxt = await page.locator('#tv-daypick-modal').innerText();
ok(pickTxt.includes('From your lookbook') && /Robes styles one/.test(pickTxt), 'sheet offers lookbook and Robes doors');
await page.evaluate(() => window.__tvDayPickApply(1, 3));
await page.waitForTimeout(200);
ok(await page.evaluate(() => window.__lastTvData.looks[1].pins.indexOf(3) !== -1), 'picking a trip look pins it to the day');
ok(await page.locator('#tv-stage .rbc-panel').count() === 1, 'the day console opens on the freshly pinned day');
ok((await page.locator('#tv-stage').innerText()).includes('EVENING · FREE'), 'one pinned look leaves the evening free — the tab invites dressing it');

// ── 7. Edit details: dates clamp everything day-indexed ──
await page.evaluate(() => window.__tvEditDetails());
await page.waitForTimeout(150);
ok(await page.locator('#tv-edit-modal').count() === 1, 'Edit details modal opens');
ok(await page.evaluate(() => document.getElementById('tv-ed-dest').value) === 'Lahinch', 'destination prefilled');
await page.evaluate(() => {
  document.getElementById('tv-ed-title').value = 'Lahinch, shorter';
  document.getElementById('tv-ed-to').value = '2026-08-01';
  document.getElementById('tv-ed-vibe').value = 'Salt air';
});
await page.evaluate(() => window.__tvEditDetailsSave());
await page.waitForTimeout(250);
const edited = await page.evaluate(() => ({
  days: window.__lastTvData.tripDays,
  headline: window.__lastTvData.headline,
  vibe: window.__lastTvData.vibe,
  pins1: window.__lastTvData.looks[1].pins.slice(),
  titles: JSON.parse(JSON.stringify(window.__lastTvData.dayTitles)),
}));
ok(edited.days === 2, 'shorter dates shrink the trip');
ok(edited.headline === 'Lahinch, shorter' && edited.vibe === 'Salt air', 'title and vibe save');
ok(edited.pins1.indexOf(3) === -1, 'pins past the end are clamped');
ok(!edited.titles['3'], 'day titles past the end are clamped');
ok(await page.locator('#tv-weekstrip .tvw-card').count() === 2, 'week strip re-renders to the new length');

// ── 7b. Looks collapse: one row by default, expand on demand ──
await page.evaluate(() => {
  const l = window.__lastTvData.looks[1];
  for (let i = 0; i < 3; i++) window.__lastTvData.looks.push({ occasion: 'Extra ' + (i + 1), title: 'Extra look ' + (i + 1), how: '', pins: [], overrides: {}, slotOverrides: {}, formula: l.formula.slice(0, 2).map(f => ({ ...f })) });
  window.__tvRenderResult(window.__lastTvData, { skipSave: true, savedId: null });
});
await page.waitForTimeout(250);
ok(await page.locator('#tv-looksrow .tvm-lookcard').count() === 4, 'six looks collapse to one desktop row');
ok(/Show all 6 looks/.test(await page.locator('#tv-looks-more').innerText()), 'the fold names what it hides');
await page.evaluate(() => window.__tvLooksToggle());
await page.waitForTimeout(150);
ok(await page.locator('#tv-looksrow .tvm-lookcard').count() === 6, 'expanding shows every look');
ok(/Show fewer/.test(await page.locator('#tv-looks-more').innerText()), 'the toggle offers the way back');

// pin from the bar: the stage flips to the day it just dressed
await page.evaluate(() => window.__tvSelectLook(3));
await page.waitForTimeout(200);
ok(await page.locator('#tv-stage .tvm-pinbar .chip').count() === 2, 'the pin bar offers every trip day');
await page.evaluate(() => window.__tvStagePin(1));
await page.waitForTimeout(200);
ok(await page.evaluate(() => window.__lastTvData.looks[3].pins.indexOf(1) !== -1), 'the bar pins the stage look to the day');
ok(await page.locator('#tv-stage .rbc-hbtn', { hasText: 'Unpin from this day' }).count() === 1, 'the stage flips to the day view');

// ── 8. Empty canvas trip ──
await page.evaluate((fx) => window.__tvRenderResult(fx), EMPTY_TRIP);
await page.waitForTimeout(250);
ok(await page.locator('#tv-weekstrip .tvw-card').count() === 5, 'canvas trip renders its week from the dates alone');
const emptyTxt = await page.locator('#tv-looks-empty').innerText();
ok(/No looks yet/.test(emptyTxt) && /Robes styles the trip/.test(emptyTxt), 'empty looks state offers the Robes door');
ok((await page.locator('#tv-capbody').innerText()).includes('Nothing in the case yet'), 'empty capsule reads as an invitation');
ok((await page.locator('#tv-mastmeta').innerText()).includes('Paula’s Ibiza'), 'canvas vibe pill renders');

// ── 9. Legacy save migrates ──
await page.evaluate((fx) => window.__tvRenderResult(fx, { skipSave: true, savedId: null }), LEGACY);
await page.waitForTimeout(250);
const mig = await page.evaluate(() => ({ n: window.__lastTvData.looks.length, occ: window.__lastTvData.looks.map(l => l.occasion), pins: window.__lastTvData.looks.map(l => l.pins) }));
ok(mig.n === 2, 'legacy day slots become 2 looks');
ok(mig.pins.every(p => p.length === 1 && p[0] === 0), 'both pinned to their old day');
await page.evaluate(() => window.__tvSelectDay(0));
await page.waitForTimeout(150);
ok(await page.locator('#tv-stage .rbc-panel').count() === 1, 'migrated day renders the console');

// ── 10. Mobile (390px): week strip scrolls sideways, nothing overflows ──
const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const mPage = await mCtx.newPage();
mPage.on('pageerror', (e) => console.log('  [pageerror-m]', e.message));
await mPage.route('**cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA_STUB }));
await mPage.route('**ayowpaknssulsqqvwpqx.supabase.co/**', (r) => {
  const u = r.request().url(); const m = r.request().method();
  if (m !== 'GET') return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  return r.fulfill({ status: 200, contentType: 'application/json', body: u.includes('wardrobe_items') ? JSON.stringify(WARDROBE) : '[]' });
});
await mPage.route('**nominatim**', (r) => r.abort());
await mPage.route('**open-meteo**', (r) => r.abort());
await mPage.addInitScript(() => {
  window.__TEST_PROFILE = { first_name: 'Annie', style_icons: [], style_dna: {}, wardrobe_items_count: 5, onboarded_at: '2026-07-01', gender_identity: 'woman' };
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
});
await mPage.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
await mPage.waitForFunction(() => typeof window.__tvRenderResult === 'function', null, { timeout: 15000 });
await mPage.waitForTimeout(600);
await mPage.evaluate((fx) => window.__tvRenderResult(fx), FIXTURE);
await mPage.waitForTimeout(300);
ok(await mPage.evaluate(() => getComputedStyle(document.getElementById('tv-weekstrip')).display) === 'flex', 'mobile week strip is a horizontal scroller');
ok(await mPage.evaluate(() => {
  const p = document.getElementById('tv-result-page');
  return p.scrollWidth <= p.clientWidth + 1;
}), 'mobile: no horizontal page overflow');
ok(await mPage.evaluate(() => !document.getElementById('tv-capbody') || getComputedStyle(document.getElementById('tv-capbody')).display === 'none'), 'mobile capsule drawer starts folded');
ok(await mPage.locator('#tv-looksrow .tvm-lookcard').count() === 2, 'mobile looks collapse to a 2-card row');
ok(/Show all 3 looks/.test(await mPage.locator('#tv-looks-more').innerText()), 'mobile fold names what it hides');
ok(!(await mPage.locator('#tv-sec-stage').isVisible()), 'mobile: no inline stage section while nothing is open');
await mPage.evaluate(() => window.__tvSelectDay(0));
await mPage.waitForTimeout(250);
ok(await mPage.evaluate(() => getComputedStyle(document.getElementById('tv-stage')).position) === 'fixed', 'mobile stage rises as a sheet over the page');
ok(await mPage.locator('#tv-stage-scrim').isVisible(), 'the scrim sits behind the sheet');
ok(await mPage.locator('#tv-stage .tv-sheethead .x').isVisible(), 'the sheet carries its close button');
await mPage.evaluate(() => window.__tvStageClose());
await mPage.waitForTimeout(200);
ok(!(await mPage.locator('#tv-sec-stage').isVisible()), 'closing the sheet returns her to the list');
await mCtx.close();

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.kill();
process.exit(fail ? 1 : 0);
