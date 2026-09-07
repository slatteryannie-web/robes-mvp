// Piece page smoke — the piece as its own page (Robes_Piece_IA, 2026-09-07):
// the wardrobe door (full record — wears, looks, build tile, Style it three
// ways), the look door (preview + pager, back to the look), the one shared
// editor behind the pencil, the wishlist on the same anatomy, the /piece/:id
// address, and the 390px shell.
// Run manually: npm i --no-save playwright && node scripts/piece_page_smoke.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 4391;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res) => {
  const on = (b) => { if (String(b).includes(String(PORT)) || String(b).includes('listening')) res(); };
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

const PIECES = [
  { id: 'w-top1', label: 'Cream silk shirt',   category: 'Tops',        color: 'Cream',  price: 180, times_worn: 8, brand: 'Arket', notes: 'Close-fitting base under the open shirt.' },
  { id: 'w-top2', label: 'Ribbed white tank',  category: 'Tops',        color: 'White',  price: 40 },
  { id: 'w-bot1', label: 'Barrel-leg jeans',   category: 'Bottoms',     color: 'Navy',   price: 220 },
  { id: 'w-bot2', label: 'Linen shorts',       category: 'Bottoms',     color: 'Cream',  price: 90 },
  { id: 'w-sho1', label: 'Flat leather sandals', category: 'Shoes',     color: 'Camel',  price: 160 },
  { id: 'w-sho2', label: 'Tan leather slides', category: 'Shoes',       color: 'Camel',  price: 120 },
  { id: 'w-bag1', label: 'Woven straw tote',   category: 'Bags',        color: 'Cream',  price: 140 },
  { id: 'w-acc1', label: 'Gold hoops',         category: 'Accessories', color: 'Ochre',  price: 60 },
];
const wardrobe = () => PIECES.map((p, i) => ({
  user_id: 'u-test', brand: 'Studio', notes: '', times_worn: 0, item_dna: {}, hero_position: null, seasons: null, occasions: null,
  image_url: 'https://res.cloudinary.com/demo/image/upload/' + p.id + '.jpg',
  created_at: new Date(Date.now() - i * 1000).toISOString(),
  ...p,
}));
const SEED_LOOKS = [
  { id: 'lk-1', user_id: 'u-test', name: 'The Thursday one', name_provisional: false, note: 'Cream silk shirt with the barrel-leg jeans.', photo_url: null, source: 'wear', origin_look_id: null, created_at: '2026-07-20T10:00:00Z' },
  { id: 'lk-2', user_id: 'u-test', name: 'The tank one', name_provisional: true, note: '', photo_url: null, source: 'wear', origin_look_id: null, created_at: '2026-07-22T10:00:00Z' },
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
  { id: 'we-1', look_id: 'lk-1', user_id: 'u-test', worn_on: '2026-07-23', piece_ids: ['w-top1', 'w-bot1', 'w-sho1', 'w-bag1'], source: 'looks', source_id: null },
  { id: 'we-2', look_id: 'lk-1', user_id: 'u-test', worn_on: '2026-07-09', piece_ids: ['w-top1', 'w-bot1', 'w-sho2', 'w-bag1'], source: 'looks', source_id: null },
  { id: 'we-3', look_id: 'lk-2', user_id: 'u-test', worn_on: '2026-07-30', piece_ids: ['w-top2', 'w-bot2', 'w-sho2'], source: 'looks', source_id: null },
];
const SEED_WISH = [
  { id: 'wl-1', user_id: 'u-test', label: 'Camel wool coat', brand: 'Toteme', category: 'Outerwear', color: 'Camel', price: 690,
    image_url: 'https://res.cloudinary.com/demo/image/upload/wl-1.jpg', note: 'For the winter edit.', source_type: 'robes', source_label: null, created_at: '2026-08-01T10:00:00Z' },
];
const DAILY_RESP = {
  headline: 'Coffee run, elevated.', occasion_label: 'a coffee run', stylist_summary: 'The shirt leads; everything else stays quiet.',
  transition_tip: '', palette: ['#EDE7DE'],
  steps: [
    { title: 'The Anchor', items: [{ name: 'Cream silk shirt', category: 'Tops', description: '', wardrobe_index: 0,
      wardrobe_match: { id: 'w-top1', label: 'Cream silk shirt', image_url: 'https://res.cloudinary.com/demo/image/upload/w-top1.jpg', color: 'Cream' }, alternates: [] }] },
    { title: 'The Canvas', items: [{ name: 'Barrel-leg jeans', category: 'Bottoms', description: '', wardrobe_index: 2,
      wardrobe_match: { id: 'w-bot1', label: 'Barrel-leg jeans', image_url: 'https://res.cloudinary.com/demo/image/upload/w-bot1.jpg', color: 'Navy' }, alternates: [] }] },
    { title: 'The Texture', items: [{ name: 'Charcoal knit cardigan', category: 'Outerwear', description: '', wardrobe_index: -1, retailer_hint: 'Arket', price_point: '€89', alternates: [] }] },
    { title: 'The Accents', items: [{ name: 'Woven raffia tote', category: 'Bags', description: '', wardrobe_index: -1, retailer_hint: 'Zara', price_point: '€49', alternates: [] }] },
  ],
};
const STYLE_RESP = {
  ways: [
    { eyebrow: 'One', title: 'Way One', outfit: 'x', details: 'x', accessories: 'x' },
    { eyebrow: 'Two', title: 'Way Two', outfit: 'x', details: 'x', accessories: 'x' },
    { eyebrow: 'Three', title: 'Way Three', outfit: 'x', details: 'x', accessories: 'x' },
  ],
  generatedImages: [null, null, null], fallback: false, photoUrl: null,
};

async function boot(browser, { width = 1280, path = '/dashboard' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1100 }, hasTouch: width < 768 });
  const page = await ctx.newPage();
  const writes = [];
  const api = { style: [], daily: 0 };
  await page.route('**cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA_STUB }));
  await page.route('**ayowpaknssulsqqvwpqx.supabase.co/**', (r) => {
    const req = r.request(); const u = req.url(); const m = req.method();
    if (m !== 'GET') {
      let body = null; try { body = req.postDataJSON(); } catch (_) { body = req.postData(); }
      writes.push({ method: m, url: u.split('/rest/v1/')[1] || u, body });
      return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    let body = '[]';
    if (u.includes('wardrobe_items')) body = JSON.stringify(wardrobe());
    else if (u.includes('wishlist_items')) body = JSON.stringify(SEED_WISH);
    else if (u.includes('/looks')) body = JSON.stringify(SEED_LOOKS);
    else if (u.includes('look_pieces')) body = JSON.stringify(SEED_PIECES);
    else if (u.includes('/wears')) body = JSON.stringify(SEED_WEARS);
    return r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.route('**res.cloudinary.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') }));
  await page.route('**nominatim**', (r) => r.abort());
  await page.route('**open-meteo**', (r) => r.abort());
  await page.route('**/api/wardrobe/upload', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://res.cloudinary.com/demo/image/upload/replaced.jpg' }) }));
  await page.route('**/api/daily', async (r) => { api.daily++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DAILY_RESP) }); });
  await page.route('**/api/style', async (r) => {
    try { api.style.push(r.request().postDataJSON()); } catch (_) { api.style.push(null); }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STYLE_RESP) });
  });
  await page.addInitScript(() => {
    window.__TEST_PROFILE = {
      first_name: 'Annie', last_name: '', mobile: '', style_icons: [], budget: null,
      wardrobe_description: '', style_dna: {}, wardrobe_items_count: 8,
      onboarded_at: '2026-07-01', gender_identity: 'woman',
    };
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2800);
  return { ctx, page, errs, writes, api };
}

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });
process.on('uncaughtException', (e) => { console.error(String(e).split('\n')[0]); report(); server.kill(); process.exit(1); });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const SHOT = process.env.SHOT_DIR || '';

// ── 1 · The wardrobe door — the full record ──────────────────────────────
{
  const { ctx, page, errs, writes, api } = await boot(browser);
  await page.evaluate(() => window.__rbNavGo('wardrobe'));
  await page.waitForTimeout(500);
  const card = page.locator('#wg-grid .wg-item:has-text("Cream silk shirt")').first();
  check('wardrobe · the grid card exists', await card.count() === 1);
  await card.click();
  await page.waitForTimeout(400);
  const pg = page.locator('#rb-piece-page');
  check('wardrobe · the card opens the piece page (not the editor)', await pg.isVisible() && !(await page.locator('#wa-modal .fm-step').isVisible()));
  check('wardrobe · the address is the piece', await page.evaluate(() => location.pathname) === '/piece/w-top1');
  const t = (await pg.innerText()).replace(/\n/g, ' ');
  check('wardrobe · back pill reads Wardrobe', (await page.locator('.rb-pc-back').innerText()).trim() === 'Wardrobe');
  check('wardrobe · eyebrow + title + brand', /In your wardrobe/i.test(t) && t.includes('Cream silk shirt') && t.includes('Arket'));
  check('wardrobe · the favourite star sits in the header', await page.locator('.rb-pc-head .rb-pc-star').count() === 1);
  check('wardrobe · no category/worn header on the card (the Worn rule carries it)', await page.locator('.rb-pc-cardhead').count() === 0);
  check('wardrobe · the photo renders with a replace-photo button', await page.locator('.rb-pc-photo img').count() === 1 && await page.locator('#rb-pc-rephoto').count() === 1);
  check('wardrobe · the note reads in italic serif', t.includes('Close-fitting base under the open shirt.'));
  const tags = await page.locator('.rb-pc-tag').allInnerTexts();
  check('wardrobe · tags carry the season band and the wear-for defaults', tags.includes('Year-round') && tags.includes('Everyday'), JSON.stringify(tags));
  check('wardrobe · Worn rule reads the count in words', /Worn\s*eight times/i.test(t), t.slice(0, 400));
  const wearRows = await page.locator('.rb-pc-wear').allInnerTexts();
  check('wardrobe · recent wears list date + look', wearRows.length === 2 && /Jul/.test(wearRows[0]) && wearRows[0].includes('The Thursday one'), JSON.stringify(wearRows));
  check('wardrobe · no view-all link below three wears', await page.locator('.rb-pc-link').count() === 0);
  check('wardrobe · In N looks rail names the saved look', /In 1 look/i.test(t) && t.includes('The Thursday one') && /Worn 23 Jul/.test(t));
  check('wardrobe · the dashed build tile invites the next look', await page.locator('.rb-pc-build').count() === 1 && t.includes('A second look') && t.includes('Build it from this piece'));
  check('wardrobe · Style it three ways is the one full-width commitment', await page.locator('.rb-pc-cta').count() === 1 && /Style it three ways/i.test(await page.locator('.rb-pc-cta').innerText()));
  check('wardrobe · the nav lights Wardrobe', await page.locator('#rb-tn-wardrobe').evaluate((e) => e.classList.contains('active')));
  if (SHOT) await page.screenshot({ path: SHOT + '/piece-wardrobe.png', fullPage: false });

  // The pencil opens the ONE editor
  await page.locator('.rb-pc-pencil').click();
  await page.waitForTimeout(700);
  const ed = await page.evaluate(() => ({
    txt: (document.querySelector('#wa-modal .fm-step')?.innerText || '').replace(/\n/g, ' '), label: document.querySelector('#wa-modal input[type=text]')?.value || '' }));
  ed.open = await page.locator('#wa-modal .fm-step').isVisible();
  check('editor · the pencil opens the wardrobe edit form, prefilled', ed.open && (ed.txt.includes('Cream silk shirt') || ed.label === 'Cream silk shirt'), JSON.stringify(ed).slice(0, 300));
  check('editor · Update piece + Remove from wardrobe live on the editor', /Update piece/i.test(ed.txt) && /Remove from wardrobe/i.test(ed.txt), ed.txt.slice(0, 300));
  await page.evaluate(() => window.WA && WA.close());
  await page.waitForTimeout(300);
  check('editor · closing returns to the page', await pg.isVisible());

  // Replace photo: downscale → upload → PATCH image_url → the page repaints
  await page.setInputFiles('#rb-pc-photoin', { name: 'shirt.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  await page.waitForTimeout(900);
  const photoWrite = writes.find((w) => w.method === 'PATCH' && /wardrobe_items\?id=eq\.w-top1/.test(w.url) && w.body && w.body.image_url);
  check('photo · the replace button uploads and PATCHes image_url', !!photoWrite && photoWrite.body.image_url.endsWith('replaced.jpg'), JSON.stringify(photoWrite && photoWrite.body));
  check('photo · the page shows the new photograph', (await page.locator('.rb-pc-photo img').getAttribute('src') || '').endsWith('replaced.jpg'));

  // The star favourites
  await page.locator('.rb-pc-star').click();
  await page.waitForTimeout(300);
  check('star · toggles the Hero Rack (PATCH hero_position) and lights up',
    writes.some((w) => w.method === 'PATCH' && /wardrobe_items\?id=eq\.w-top1/.test(w.url) && w.body && w.body.hero_position != null)
    && await page.locator('.rb-pc-star').evaluate((e) => e.classList.contains('on')));

  // A wear row opens the look
  await page.locator('.rb-pc-wear').first().click();
  await page.waitForTimeout(600);
  check('wear row · opens the saved look', !(await pg.isVisible()) && (await page.locator('#sn-page').innerText()).includes('The Thursday one'));

  // ── 2 · The look door — preview, pager, back to the look ───────────────
  const names = page.locator('#sn-page .rbc-rack .rbc-namebtn');
  check('look · every owned rack row names a tappable piece', await names.count() === 4);
  await names.first().click();
  await page.waitForTimeout(400);
  const t2 = (await pg.innerText()).replace(/\n/g, ' ');
  check('look · the row opens the piece page from the look', await pg.isVisible());
  check('look · back pill reads the look\'s name', (await page.locator('.rb-pc-back').innerText()).trim() === 'The Thursday one');
  check('look · pager reads 1 of 4', /1 of 4/i.test(t2));
  check('look · card header carries category · worn', /Tops/i.test(t2) && /Worn eight times/i.test(t2) && await page.locator('.rb-pc-cardhead').count() === 1);
  check('look · no wear ledger on the preview', await page.locator('.rb-pc-rule').count() === 0 && await page.locator('.rb-pc-wear').count() === 0);
  check('look · In N looks rail, then the record link', /In 1 look/i.test(t2) && /See the full record in your wardrobe/.test(t2));
  check('look · no build tile, no Style CTA on the preview', await page.locator('.rb-pc-build').count() === 0 && await page.locator('.rb-pc-cta').count() === 0);
  check('look · the nav stays on Lookbook', await page.locator('#rb-tn-lookbook').evaluate((e) => e.classList.contains('active')));
  if (SHOT) await page.screenshot({ path: SHOT + '/piece-look.png', fullPage: false });
  await page.locator('.rb-pc-nav').nth(1).click();
  await page.waitForTimeout(300);
  const t3 = (await pg.innerText()).replace(/\n/g, ' ');
  check('look · next walks to the second piece', /2 of 4/i.test(t3) && t3.includes('Barrel-leg jeans'));
  check('look · a piece worn in two wears reads twice (from the wear snapshots, not times_worn)', /Worn twice/i.test(t3), t3.slice(0, 300));
  await page.locator('.rb-pc-back').click();
  await page.waitForTimeout(300);
  check('look · back returns to the look underneath', !(await pg.isVisible()) && await page.locator('#sn-page').isVisible());

  // The record link flips doors
  await names.first().click();
  await page.waitForTimeout(300);
  await page.locator('.rb-pc-link', { hasText: 'See the full record' }).click();
  await page.waitForTimeout(300);
  check('record link · the page reopens as the wardrobe\'s record', (await page.locator('.rb-pc-back').innerText()).trim() === 'Wardrobe' && await page.locator('.rb-pc-cta').count() === 1);

  // The build tile lands in the composer with the piece on the rack
  await page.locator('.rb-pc-build').click();
  await page.waitForTimeout(700);
  check('build · the composer opens with the piece already on the rack',
    !(await pg.isVisible()) && await page.locator('#sn-page .rb-lk-composer').count() === 1
    && (await page.locator('#sn-page .rb-lk-composer').innerText()).includes('Cream silk shirt'));

  // Style it three ways — prefilled modal in Inspiration
  await page.evaluate(() => window.__rbPieceOpen('w-top1', { from: 'wardrobe' }));
  await page.waitForTimeout(300);
  await page.locator('.rb-pc-cta').click();
  await page.waitForTimeout(600);
  const mt = await page.locator('#rb-inst-wrap').innerText();
  check('style · lands in Inspiration with the modal open', await page.locator('#rb-insp-page').isVisible() && await page.locator('#rb-inst-wrap').count() === 1);
  check('style · the piece arrives attached', await page.locator('#rb-inst-piece').count() === 1 && /Your key piece/i.test(mt) && mt.includes('Cream silk shirt'));
  check('style · the hint says Robes already knows it', /Robes already knows the shirt/.test(mt), mt.slice(0, 300));
  check('style · the prompt asks for the occasion', (await page.locator('#rb-inst-ta').getAttribute('placeholder') || '').startsWith('The occasion'));
  await page.locator('.rb-inst-cta').click();
  await page.waitForTimeout(900);
  check('style · a bare submit runs with Robes\' own words', api.style.length === 1 && /^Style my Cream silk shirt three ways/.test(api.style[0]?.prompt || ''), JSON.stringify(api.style[0]?.prompt));
  check('style · the result lands on the kp page', await page.locator('#kp-result-page').isVisible());
  check('no page errors (wardrobe + look doors)', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ── 3 · The daily console door + the wishlist + history ─────────────────
{
  const { ctx, page, errs, writes } = await boot(browser);
  await page.evaluate(() => window.__dlSubmit('an outfit for a coffee run'));
  await page.waitForTimeout(1500);
  const dlNames = page.locator('#dl-result-page .rbc-rack .rbc-namebtn');
  check('daily · only owned rows are doors (2 of 4)', await dlNames.count() === 2);
  await dlNames.first().click();
  await page.waitForTimeout(400);
  const pg = page.locator('#rb-piece-page');
  const t = (await pg.innerText()).replace(/\n/g, ' ');
  check('daily · opens from the look with the headline as the way back', await pg.isVisible() && (await page.locator('.rb-pc-back').innerText()).trim() === 'Coffee run, elevated');
  // The rack groups Canvas before Anchor, so the first row is the jeans.
  check('daily · pager over the two owned pieces', /2 of 2/i.test(t) && t.includes('Barrel-leg jeans'), t.slice(0, 200));
  check('daily · the rail names the daily look itself alongside the saved look', /In 2 looks/i.test(t) && t.includes('Coffee run, elevated.'), t.slice(0, 300));
  check('daily · the nav lights Lookbook under a daily look', await page.locator('#rb-tn-lookbook').evaluate((e) => e.classList.contains('active')));
  await page.locator('.rb-pc-back').click();
  await page.waitForTimeout(300);
  check('daily · back lands on the console', !(await pg.isVisible()) && await page.locator('#dl-result-page').isVisible());
  check('no page errors (daily door)', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ── 3b · The wishlist on the same anatomy, and history ───────────────────
// (A fresh boot: leaving the unkept daily look above would raise its own
// "Keep this look?" guard, which is the app's rule, not this page's.)
{
  const { ctx, page, errs, writes } = await boot(browser);
  const pg = page.locator('#rb-piece-page');
  await page.evaluate(() => window.__rbNavGo('wardrobe'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__waSetView('wishlist'));
  await page.waitForTimeout(400);
  await page.locator('#rb-wl-grid .rb-wl-item:has-text("Camel wool coat") .rb-wl-tile').click();
  await page.waitForTimeout(400);
  const wt = await pg.innerText();
  check('wishlist · the card opens the page', await pg.isVisible() && wt.includes('Camel wool coat') && wt.includes('Toteme'));
  check('wishlist · eyebrow + back pill', /On your wishlist/i.test(wt) && (await page.locator('.rb-pc-back').innerText()).trim() === 'Wishlist');
  check('wishlist · no pencil, no replace-photo (nothing to edit yet)', await page.locator('.rb-pc-pencil').count() === 0 && await page.locator('#rb-pc-rephoto').count() === 0);
  const wtags = await page.locator('.rb-pc-tag').allInnerTexts();
  check('wishlist · provenance + price stand where the tags do', wtags.includes('Robes suggests') && wtags.includes('€690'), JSON.stringify(wtags));
  check('wishlist · the note reads', wt.includes('For the winter edit.'));
  check('wishlist · I bought this + Remove at the foot', /I bought this/i.test(wt) && /Remove from wishlist/.test(wt));
  check('wishlist · no wear ledger, no looks rail', await page.locator('.rb-pc-rule').count() === 0 && await page.locator('.rb-pc-rail').count() === 0);
  check('wishlist · the address', await page.evaluate(() => location.pathname) === '/piece/wl-1');
  if (SHOT) await page.screenshot({ path: SHOT + '/piece-wishlist.png', fullPage: false });
  await page.locator('.rb-pc-quiet').click();
  await page.waitForTimeout(300);
  check('wishlist · Remove asks first', await page.locator('#rb-del-modal').count() === 1);
  await page.locator('#rb-del-modal button', { hasText: /delete|remove/i }).first().click();
  await page.waitForTimeout(500);
  check('wishlist · a removed piece closes its page onto the wishlist tab',
    !(await pg.isVisible()) && writes.some((w) => w.method === 'DELETE' && /wishlist_items\?id=eq\.wl-1/.test(w.url))
    && await page.evaluate(() => location.pathname) === '/wishlist');

  // History: back walks the page away
  await page.evaluate(() => window.__waSetView('all'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__rbPieceOpen('w-bot1', { from: 'wardrobe' }));
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForTimeout(400);
  check('history · browser back closes the page', !(await pg.isVisible()));
  await page.goForward();
  await page.waitForTimeout(500);
  check('history · forward reopens it at its address', await pg.isVisible() && (await pg.innerText()).includes('Barrel-leg jeans'));
  check('no page errors (wishlist + history)', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ── 4 · The address on a cold load, and the 390px shell ─────────────────
{
  const { ctx, page, errs } = await boot(browser, { width: 390, path: '/piece/w-top1' });
  const pg = page.locator('#rb-piece-page');
  check('deep link · /piece/:id opens the record once the wardrobe lands', await pg.isVisible() && (await pg.innerText()).includes('Cream silk shirt'));
  check('mobile · the page carries its own back pill; the nav back pill stands down',
    await page.locator('.rb-pc-back').isVisible() && !(await page.locator('#rb-backpill').isVisible()));
  check('mobile · no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('mobile · the dock stays reachable over the page', await page.locator('#rb-dock').isVisible()
    && await page.evaluate(() => { const d = document.getElementById('rb-dock'); const r = d.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(e && d.contains(e)); }));
  if (SHOT) await page.screenshot({ path: SHOT + '/piece-mobile.png', fullPage: false });
  await page.locator('.rb-pc-back').click();
  await page.waitForTimeout(500);
  check('deep link · back opens the wardrobe it belongs to', !(await pg.isVisible()) && await page.locator('.wardrobe-panel').evaluate((e) => e.classList.contains('visible')));
  check('no page errors (deep link + mobile)', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
server.kill();
report();
function report() {
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.name + (r.pass || !r.detail ? '' : '\n      ' + r.detail));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
}
process.exit(results.some((r) => !r.pass) ? 1 : 0);
