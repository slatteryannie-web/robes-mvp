import 'dotenv/config';
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'fs';
import { GoogleGenAI } from '@google/genai';
import { buildColorHarmony, buildSilhouette, styleDnaPromptBlock } from './style_dna.js';
import { TAXONOMY_GROUPS, resolveTaxonomy, taxonomyPromptBlock, tagDefaultRows, WEAR_SEEDS } from './wardrobe_taxonomy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

/* ── look store (in-memory, 48h TTL) ────────────────────────────── */
const lookStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  for (const [id, look] of lookStore) {
    if (look.created < cutoff) lookStore.delete(id);
  }
}, 60 * 60 * 1000);

/* ── image job store (in-memory, 10min TTL) ──────────────────────── */
const imageJobs = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, job] of imageJobs) {
    if (job.created < cutoff) imageJobs.delete(id);
  }
}, 5 * 60 * 1000);

app.use(express.json({ limit: '20mb' }));
app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/* ── structured AI logging ───────────────────────────────────────── */
function logAI(event) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

/* ── generation_log — LLM call trail (admin capture, migration 11) ── */
// Every Gemini call is recorded to Supabase generation_log with the
// service role (bypasses RLS by design): endpoint, model, latency,
// tokens, status and the FULL prompt/response — the learning corpus,
// admin-read-only. A request-scoped AsyncLocalStorage context carries
// endpoint + userId into the background image loops, and one wrapper on
// ai.models.generateContent covers every endpoint without touching them.
// Degrades to a no-op until SUPABASE_SERVICE_ROLE_KEY is set on the
// Railway service.
const SUPA_URL = process.env.SUPABASE_URL || 'https://ayowpaknssulsqqvwpqx.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_ENV = (process.env.PUBLIC_URL || '').includes('www.byrobes.com') ? 'production' : 'beta';
const genCtx = new AsyncLocalStorage();

app.use('/api', (req, res, next) => {
  const uid = req.body && typeof req.body.userId === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(req.body.userId)
    ? req.body.userId : null;
  // genId: client-minted per-generation correlation id — the same id is
  // stored inside the saved lookbook entry, so the admin panel can join
  // "her typed prompt → every LLM call → the artifact" without a schema
  // change (it lives in generation_log.detail).
  const genId = req.body && typeof req.body.genId === 'string' ? req.body.genId.slice(0, 24) : null;
  const rawPrompt = req.body && (req.body.prompt || req.body.brief || req.body.activity);
  const userPrompt = typeof rawPrompt === 'string' && rawPrompt.trim() ? rawPrompt.trim().slice(0, 400) : null;
  genCtx.run({ endpoint: req.baseUrl + req.path, userId: uid, genId, userPrompt }, next);
});

function glog(row) {
  if (!SUPA_SERVICE_KEY) return;
  fetch(SUPA_URL + '/rest/v1/generation_log', {
    method: 'POST',
    headers: {
      'apikey': SUPA_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPA_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ environment: APP_ENV, ...row }),
  }).then(r => {
    if (!r.ok) return r.text().then(t => console.warn('generation_log insert failed:', r.status, t.slice(0, 200)));
  }).catch(err => console.warn('generation_log insert failed:', err.message));
}

// Flatten a generateContent params object into loggable prompt text —
// system instruction + every text part; inline images counted, never stored.
function genPromptText(params) {
  const parts = [];
  const sys = params && params.config && params.config.systemInstruction;
  if (typeof sys === 'string') parts.push(sys);
  else if (sys && Array.isArray(sys.parts)) sys.parts.forEach(p => { if (p.text) parts.push(p.text); });
  let images = 0;
  const contents = Array.isArray(params?.contents) ? params.contents : (params?.contents ? [params.contents] : []);
  for (const c of contents) {
    if (typeof c === 'string') { parts.push(c); continue; }
    for (const p of (c.parts || [])) {
      if (p.text) parts.push(p.text);
      if (p.inlineData) images++;
    }
  }
  return { text: parts.join('\n\n'), images };
}

if (SUPA_SERVICE_KEY) {
  const rawGenerate = ai.models.generateContent.bind(ai.models);
  ai.models.generateContent = async function (params) {
    const t0 = Date.now();
    const ctx = genCtx.getStore() || {};
    const base = {
      user_id: ctx.userId || null,
      endpoint: ctx.endpoint || 'background',
      model: (params && params.model) || null,
    };
    const { text: promptText, images: imagesIn } = genPromptText(params);
    const isImageModel = String(params && params.model || '').includes('image');
    try {
      const r = await rawGenerate(params);
      let respText = null;
      try { respText = r.text; } catch (_) { /* image-only responses */ }
      let responseJson = null, hasImage = false;
      if (isImageModel) {
        hasImage = !!(r.candidates && r.candidates[0]?.content?.parts?.some(p => p.inlineData));
        responseJson = { has_image: hasImage };
      } else if (respText) {
        try { responseJson = JSON.parse(respText); } catch (_) { responseJson = { text: String(respText) }; }
      }
      glog({
        ...base,
        tokens_used: (r.usageMetadata && r.usageMetadata.totalTokenCount) ?? null,
        latency_ms: Date.now() - t0,
        status: isImageModel && !hasImage ? 'partial' : 'ok',
        prompt: promptText || null,
        response: responseJson,
        detail: { input_images: imagesIn, ...(ctx.genId ? { gen_id: ctx.genId } : {}), ...(ctx.userPrompt ? { user_prompt: ctx.userPrompt } : {}) },
      });
      return r;
    } catch (err) {
      glog({
        ...base,
        latency_ms: Date.now() - t0,
        status: /timeout|timed out|deadline/i.test(String(err && err.message)) ? 'timeout' : 'error',
        prompt: promptText || null,
        detail: { input_images: imagesIn, error: String((err && err.message) || err).slice(0, 500), ...(ctx.genId ? { gen_id: ctx.genId } : {}), ...(ctx.userPrompt ? { user_prompt: ctx.userPrompt } : {}) },
      });
      throw err;
    }
  };
} else {
  console.log('generation_log: SUPABASE_SERVICE_ROLE_KEY not set — LLM call trail disabled');
}

/* ── Airtable ────────────────────────────────────────────────────── */
const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
console.log('Airtable config — base:', AT_BASE, '| token prefix:', AT_TOKEN ? AT_TOKEN.slice(0, 12) + '...' : 'MISSING');

async function airtableUpsert(table, fields) {
  if (!AT_TOKEN || !AT_BASE) { console.warn('Airtable: missing token or base ID'); return; }
  console.log(`Airtable: upserting to ${table}`, JSON.stringify(fields));
  try {
    const res = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ['Email'] },
        records: [{ fields }],
      }),
    });
    const body = await res.text();
    if (!res.ok) console.warn(`Airtable ${table} error ${res.status}:`, body);
    else console.log(`Airtable ${table}: ok`);
  } catch (err) { console.warn('Airtable fetch error:', err.message); }
}

async function airtableCreate(table, fields) {
  if (!AT_TOKEN || !AT_BASE) return;
  try {
    const res = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields }] }),
    });
    if (!res.ok) console.warn(`Airtable ${table} error:`, await res.text());
  } catch (err) { console.warn('Airtable error:', err.message); }
}

/* ── Cloudinary ──────────────────────────────────────────────────── */
const CLD_CLOUD  = process.env.CLOUDINARY_CLOUD_NAME;
const CLD_KEY    = process.env.CLOUDINARY_API_KEY;
const CLD_SECRET = process.env.CLOUDINARY_API_SECRET;
console.log('Cloudinary config — cloud:', CLD_CLOUD || 'MISSING');

async function cloudinaryUpload(base64Data, mimeType) {
  if (!CLD_CLOUD || !CLD_KEY || !CLD_SECRET) {
    console.warn('Cloudinary: missing config, skipping upload');
    return null;
  }
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'robes';
    const signature = createHash('sha256')
      .update(`folder=${folder}&timestamp=${timestamp}${CLD_SECRET}`)
      .digest('hex');

    const form = new FormData();
    form.append('file', `data:${mimeType};base64,${base64Data}`);
    form.append('api_key', CLD_KEY);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
    form.append('folder', folder);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLD_CLOUD}/image/upload`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) { console.warn('Cloudinary upload error:', await res.text()); return null; }
    const data = await res.json();
    console.log('Cloudinary upload ok:', data.secure_url);
    // Deliver an automatically-optimised, browser-renderable format. HEIC/HEIF
    // uploads otherwise deliver as .heic — which every non-Safari viewer fails
    // to render — even though Gemini parses the original fine. f_auto makes
    // Cloudinary transcode to webp/jpeg per the requesting browser, so every
    // downstream viewer (wardrobe grid, moodboard, lookbook, share pages) works.
    return typeof data.secure_url === 'string'
      ? data.secure_url.replace('/image/upload/', '/image/upload/f_auto,q_auto/')
      : data.secure_url;
  } catch (err) {
    console.warn('Cloudinary error:', err.message);
    return null;
  }
}

/* ── waitlist ────────────────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gemini: !!process.env.GEMINI_API_KEY,
    airtable: !!process.env.AIRTABLE_TOKEN,
    cloudinary: !!process.env.CLOUDINARY_API_KEY,
    supabase: !!process.env.SUPABASE_ANON_KEY,
    generation_log: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
});

app.post('/api/waitlist', async (req, res) => {
  const { email, name } = req.body;
  if (!email || !/.+@.+\..+/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const fields = { 'Email': email, 'Joined At': new Date().toISOString().split('T')[0] };
  if (name) fields['Name'] = name;
  await airtableUpsert('Contacts', fields);

  res.json({ ok: true });
});

/* ── instagram handle ────────────────────────────────────────────── */
app.post('/api/instagram', async (req, res) => {
  const { email, handle } = req.body;
  if (!handle) return res.status(400).json({ error: 'No handle provided' });
  const clean = handle.replace(/^@+/, '');
  await airtableUpsert('Contacts', {
    'Email': email || '',
    'Instagram Handle': clean,
  });
  res.json({ ok: true });
});

/* ── feedback ────────────────────────────────────────────────────── */
app.post('/api/feedback', async (req, res) => {
  const { email, rating, comment, prompt, pieceLink, photoUrl, looksOutput } = req.body;
  await airtableCreate('Feedback', {
    'Email': email || '',
    ...(rating != null ? { 'Rating': Number(rating) } : {}),
    'User Feedback': comment || '',
    'Prompt': prompt || '',
    'Piece Link': pieceLink || '',
    ...(photoUrl ? { 'Photo': [{ url: photoUrl }] } : {}),
    'Looks Output': looksOutput || '',
    'Created At': new Date().toISOString().split('T')[0],
  });
  res.json({ ok: true });
});

/* ── rate limiting ───────────────────────────────────────────────── */
const rateLimitMap = new Map();

function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = rateLimitMap.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count++;
    rateLimitMap.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: 'Too many requests — please wait a minute.' });
    next();
  };
}

// prune stale entries hourly
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, entry] of rateLimitMap) {
    if (entry.start < cutoff) rateLimitMap.delete(key);
  }
}, 60 * 60 * 1000);

/* ── style ───────────────────────────────────────────────────────── */
const FALLBACK_PIECE = 'black Balmain waistcoat with gold buttons';

// Shared image-prompt fragments — every on-model editorial frame uses these
// so the figure is never cropped and the user's declared taste reaches the
// image model, not just the text model.
const FULL_BODY_FRAME = 'FULL-LENGTH FRAMING, HEAD TO TOE: the entire figure fits inside the frame — the full head and hair visible with clear space above, both shoes fully visible with clear space below. Never crop the face, head, hands or feet. Subject standing, centred, photographed from far enough back to capture the whole body.';

function styleIconsImageLine(styleIcons) {
  const icons = Array.isArray(styleIcons)
    ? styleIcons.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()).slice(0, 5)
    : [];
  return icons.length
    ? `The styling sensibility channels ${icons.join(', ')} — their signature silhouettes and fashion codes. `
    : '';
}

/* ── gender identity (profiles.gender_identity, migration 13) ─────────
   'woman' (default — every signup starts here, and any missing/invalid
   value normalises to it, so pre-migration clients behave exactly as
   before), 'man' (menswear only, everywhere), or 'unspecified'
   ("Prefer not to say" — the model judges from the brief). The stylist
   prompts use "she"/"her" generically throughout; rewriting every
   pronoun per-request would be fragile, so the directive tells the
   model how to read them instead. */
const normGender = (g) => (g === 'man' || g === 'unspecified') ? g : 'woman';

function genderDirective(gender) {
  if (gender === 'man')
    return 'The user identifies as a man. Every piece, look and recommendation must be menswear — male cuts, sizing and styling codes, menswear brands and male style references throughout. Never suggest womenswear. Where these instructions use "she"/"her" generically, they refer to this male client — read them as "he"/"him".';
  if (gender === 'unspecified')
    return 'The user has not said how they identify. Use your best judgement from their words, their pieces and their wardrobe to decide whose clothing to recommend; when nothing points a direction, keep pieces and styling gender-neutral. Where these instructions use "she"/"her" generically, they simply refer to this client.';
  return 'Unless the brief clearly indicates a male wearer, style for a woman.';
}

// Image-prompt fragments — who stands in the editorial frame.
const wearerNoun = (g) => g === 'man' ? 'man' : g === 'unspecified' ? 'person' : 'woman';
const wearerWears = (g) => g === 'man' ? 'He wears' : g === 'unspecified' ? 'They wear' : 'She wears';

const STYLE_SCHEMA = {
  type: 'object',
  properties: {
    fallback: { type: 'boolean' },
    wearer: { type: 'string', enum: ['woman', 'man'] },
    ways: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          eyebrow:     { type: 'string' },
          title:       { type: 'string' },
          outfit:      { type: 'string' },
          details:     { type: 'string' },
          accessories: { type: 'string' },
          tags:        { type: 'array', items: { type: 'string' } },
        },
        required: ['eyebrow', 'title', 'outfit', 'details', 'accessories', 'tags'],
      },
    },
  },
  required: ['fallback', 'wearer', 'ways'],
};

app.post('/api/style', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const { photo, link, prompt, name, pieceName, styleDna, styleIcons, wardrobeCount, wardrobeItems, intent, context: rtContext, gender } = req.body;
  const g = normGender(gender);

  if (!photo && !link && !prompt) {
    return res.status(400).json({ error: 'Provide at least a photo, link, or prompt.' });
  }

  const daily = intent === 'dress-me';
  const who = name ? `The user's name is ${name}.` : '';
  const piece = pieceName ? `The key piece is described as: "${pieceName}".` : '';
  const context = prompt ? `Additional context from the user: "${prompt}".` : '';
  const linkCtx = link ? `The user provided a product link for reference: ${link}.` : '';
  const dnaBlock = styleDnaPromptBlock(styleDna, Number(wardrobeCount) || 0, styleIcons);

  const closetItems = Array.isArray(wardrobeItems) ? wardrobeItems.slice(0, 60) : [];
  const closetBlock = closetItems.length
    ? `THE USER'S DIGITISED WARDROBE (${closetItems.length} pieces): ${closetItems.map(i =>
        `${i.label}${i.category ? ' [' + i.category + ']' : ''}${i.color ? ', ' + i.color : ''}${Number(i.times_worn) > 0 ? `, worn ${i.times_worn}×` : ''}`
      ).join('; ')}.`
    : '';
  const closetDirective = closetItems.length >= 15
    ? 'Build each outfit primarily from the digitised wardrobe above — reference owned pieces by their exact labels, and add new pieces only where the closet has a true gap or for the Exclamation Point.'
    : closetItems.length > 0
      ? 'The user already owns the pieces listed above. Wherever an owned piece genuinely serves the look, use it and refer to it by its exact label — an owned piece always beats a hypothetical one. Fill only the true gaps with new, editorially-matched pieces. Never reach for something she would have to buy when a relevant piece is already in the list.'
      : '';

  const formulaBlock = `Every look follows the four-tier layer formula: 1) THE ANCHOR — the weather/agenda hero piece; 2) THE CANVAS — premium supporting basics; 3) THE TEXTURE — one depth-adding element; 4) THE EXCLAMATION POINT — the accessories, footwear and hardware that inject identity. Never give generic output like "jeans and a top" — name exact cuts, fabrications and styling techniques (e.g. "French-tuck a heavyweight silk button-down into high-waisted, wide-leg wool trousers").

STYLING SANITY CHECK: every styling move must be something a respected stylist would actually shoot on the street — honour the key piece's natural register. Sporty and athletic pieces stay in an elevated-casual register: never belt knitwear or cardigans over athletic shorts, never force waist-cinching or hourglass tricks onto a sporty silhouette, never layer formal tailoring over gym wear. Any silhouette or body-architecture rules below govern WHAT pieces you select — they are never a licence to contort HOW a piece is worn. If a styling trick needs explaining to look intentional, drop it: effortless always beats clever.`;

  const brief = daily
    ? `The user is dressing for a real day, happening now. You build three complete, wearable outfits for that day — each a distinct mood or register, all appropriate to the occasion and the real-time weather context provided.`
    : `When given a key fashion piece, you create three distinct, wearable looks around it — each with a clear occasion and mood. Your descriptions are specific: you name real item types, describe drape and texture, and explain why each pairing works.`;

  const fallbackRule = daily
    ? `IMPORTANT: Set "fallback": true ONLY if the input is gibberish or random characters. A plain occasion, agenda or mood (e.g. "brunch", "a day of meetings") is a valid daily brief — set "fallback": false and dress the user for it.`
    : `IMPORTANT: You must set "fallback": true if ANY of these apply — the input is gibberish or random characters; no specific clothing item, garment, or accessory can be identified; the request is too vague to style (e.g. just a colour, a single generic word, or a non-fashion concept). When fallback is true, style a ${FALLBACK_PIECE} instead. Only set "fallback": false when a real, nameable fashion piece is clearly present.`;

  const wearerRule = g === 'man'
    ? `Set "wearer" to "man" — the user is a man and every look is styled for him.`
    : g === 'unspecified'
      ? `Set "wearer" to your best judgement of who the looks are styled for, based only on the user's words and the piece itself.`
      : `Set "wearer" to who the looks are styled for: "woman" unless the user's words clearly state the wearer is male — the piece itself being menswear or unisex (sportswear, an oversized jacket, boyfriend jeans) NEVER makes the wearer male.`;

  const genderBlock = g === 'woman'
    ? 'Your user is a stylish, fashion-forward woman — unless the input clearly indicates a male wearer, style all looks for a woman.'
    : genderDirective(g);

  const systemInstruction = `You are an expert fashion stylist known for elegant, directional styling advice. Your tone is warm, precise, and editorial — like a trusted stylist who truly understands clothes. ${genderBlock} ${who}

${brief}

${formulaBlock}

${fallbackRule}

${wearerRule}${dnaBlock ? '\n\n' + dnaBlock : ''}${closetBlock ? '\n\n' + closetBlock : ''}${closetDirective ? '\n' + closetDirective : ''}`;

  const rtLine = daily && rtContext && (rtContext.city || rtContext.tempRange)
    ? `Real-time context: ${[rtContext.city, rtContext.month].filter(Boolean).join(' · ')}${rtContext.tempRange ? ' | ' + rtContext.tempRange : ''}${rtContext.condition ? ' | ' + rtContext.condition : ''}. Dress the user for exactly this weather and place.`
    : '';

  const userText = daily
    ? `${rtLine ? rtLine + '\n\n' : ''}The user's brief for today: "${prompt}".

Dress them for this day three ways. Make each outfit genuinely distinct — different moods and registers of the same day. Each look must be complete from anchor to exclamation point, and every piece weather-appropriate.`
    : `${piece} ${context} ${linkCtx}

Style this key piece three ways. Make each look genuinely distinct — different occasions, moods, and dressing codes. Be specific about how the piece is worn and what surrounds it. Each look should feel complete and real.`;

  let photoMatch = null;
  const textParts = [];

  if (photo) {
    photoMatch = photo.match(/^data:([^;]+);base64,(.+)$/);
    if (photoMatch) {
      textParts.push({ inlineData: { mimeType: photoMatch[1], data: photoMatch[2] } });
    }
  }
  textParts.push({ text: userText });

  // retry wrapper
  async function withRetry(fn, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); } catch (err) {
        if (i === attempts - 1) throw err;
        await new Promise(r => setTimeout(r, 800 * Math.pow(2, i)));
      }
    }
  }

  try {
    const t0 = Date.now();

    const [textResponse, photoUrl] = await Promise.all([
      withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: textParts }],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: STYLE_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 2000,
        },
      })),
      photoMatch ? cloudinaryUpload(photoMatch[2], photoMatch[1]) : Promise.resolve(null),
    ]);

    const textMs = Date.now() - t0;
    const parsed = deEscDeep(JSON.parse(textResponse.text));
    const fallback = parsed.fallback === true;
    const ways = parsed.ways;
    logAI({ feature: 'style', stage: 'text', model: 'gemini-2.5-flash', ms: textMs, fallback });

    // Create image job and respond immediately — images generate in background
    const jobId = randomBytes(6).toString('hex');
    imageJobs.set(jobId, { images: [null, null, null], done: false, created: Date.now() });
    res.json({ ways, jobId, photoUrl, fallback });

    // Background image generation — never blocks the client
    const t1 = Date.now();
    // 'man' setting always wins; otherwise the model's wearer judgement
    // stands (for 'unspecified' that judgement IS the routing decision, so
    // the frames match the looks it wrote).
    const wearer = g === 'man' ? 'man' : parsed.wearer === 'man' ? 'man' : 'woman';
    const iconLine = styleIconsImageLine(styleIcons);
    const briefLine = !fallback && prompt ? `The user's brief: "${String(prompt).slice(0, 200)}". ` : '';
    // Strictly ONE generation in flight at a time — the daily/travel/
    // moodboard pattern. Concurrent calls contend for the image model's
    // rate limit (that is what left looks imageless); a failed frame gets
    // one retry after a pause long enough to clear a rate-limit window.
    (async () => {
      // The kept model wears every frame when one exists (avatar phase 3):
      // the SAME person across all three looks, only the scene changes with
      // the occasion. Resolved inside the background job — the first-ever
      // cell generates here and must never delay the text response. The
      // wearer gates the catalog: a menswear brief on a woman's profile
      // (or vice versa) falls through to the generic model.
      const avatarRef = await avatarRefForUser(req.body.avatarId, req.body.userId, wearer);
      const results = ways.map(() => null);
      for (let i = 0; i < ways.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 3000));
        const w = ways[i];
        const imgParts = [];
        if (avatarRef) imgParts.push({ inlineData: { mimeType: avatarRef.mimeType, data: avatarRef.data } });
        if (!fallback && photoMatch) {
          imgParts.push({ inlineData: { mimeType: photoMatch[1], data: photoMatch[2] } });
        }
        const pieceLabel = fallback ? FALLBACK_PIECE : (pieceName || 'the clothing item');
        const pieceLine = daily && !fallback ? '' : `The key piece is ${pieceLabel}. `;
        const photoLine = !fallback && photoMatch
          ? (avatarRef
            ? 'The SECOND image shows the key piece only — reproduce the piece faithfully, but compose an entirely new scene; never copy that photo\'s framing, background or crop. '
            : 'The attached photo shows the key piece only — reproduce the piece faithfully, but compose an entirely new scene; never copy the photo\'s framing, background or crop. ')
          : '';
        imgParts.push({
          text: `PORTRAIT ORIENTATION ONLY. Single fashion editorial photograph — one ${wearer}, alone, one scene, no collage, no split panels, no side-by-side images. ${avatarRef ? AVATAR_IDENTITY : ''}${FULL_BODY_FRAME} ${pieceLine}${photoLine}${briefLine}${iconLine}Look: "${w.title}" — ${w.eyebrow}. The ${wearer} wears the complete outfit: ${String(w.outfit || '').trim().replace(/\.$/, '')}. Soft natural light, luxury campaign aesthetic.`,
        });

        const makeCall = attempt => ai.models.generateContent({
          model: 'gemini-3.1-flash-image',
          contents: [{ role: 'user', parts: imgParts }],
          config: { responseModalities: ['TEXT', 'IMAGE'] },
        }).then(async r => {
          const part = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (!part?.inlineData) {
            logAI({ feature: 'style', stage: 'image', index: i, attempt, success: false, reason: 'no_inline_data' });
            return null;
          }
          // Host on Cloudinary so the client can persist a small URL in the
          // lookbook instead of a multi-MB base64 blob; fall back to data URL
          const hosted = await cloudinaryUpload(part.inlineData.data, part.inlineData.mimeType);
          const src = hosted || `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          logAI({ feature: 'style', stage: 'image', index: i, attempt, success: true, hosted: !!hosted, ms: Date.now() - t1 });
          // Write straight onto the job — a slow call that outlived its race
          // timeout still delivers its image to the poller this way.
          const job = imageJobs.get(jobId);
          if (job && !job.images[i]) job.images[i] = src;
          return src;
        }).catch(err => {
          logAI({ feature: 'style', stage: 'image', index: i, attempt, success: false, reason: err.message });
          return null;
        });

        let src = null;
        for (let attempt = 1; attempt <= 2 && !src; attempt++) {
          if (attempt > 1) {
            logAI({ feature: 'style', stage: 'image', index: i, success: false, reason: 'retrying' });
            await new Promise(r => setTimeout(r, 8000));
          }
          src = await Promise.race([
            makeCall(attempt),
            new Promise(resolve => setTimeout(() => resolve(null), 40000)),
          ]);
          const job = imageJobs.get(jobId);
          if (!src && job && job.images[i]) src = job.images[i];
        }
        results[i] = src;
      }
      const job = imageJobs.get(jobId);
      // Merge — an image may have landed on the job after its race timed out
      if (job) { job.images = job.images.map((v, i) => v || results[i]); job.done = true; }
      logAI({ feature: 'style', stage: 'images_complete', jobId, totalMs: Date.now() - t0, successCount: results.filter(Boolean).length });
    })();
  } catch (err) {
    if (res.headersSent) return; // client already disconnected
    console.error('Gemini API error:', err.message);
    res.status(500).json({ error: err.message || 'Styling failed' });
  }
});

/* ── image job polling ───────────────────────────────────────────── */
app.get('/api/images/:jobId', (req, res) => {
  const job = imageJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  res.json({ images: job.images, done: job.done });
});

/* ── daily look — Context-to-Core framework ──────────────────────── */
// One complete outfit for a real day, built as the four architectural
// steps a senior stylist works through (Anchor → Canvas → Texture →
// Accents). The wardrobe-state directive shifts the balance from fully
// aspirational (empty closet) to closet-first (≥15 pieces); every item
// carries a wardrobe_match so the client's swap flow can trade any
// piece for something owned.
const DAILY_STEP_TITLES = ['The Anchor', 'The Canvas', 'The Texture', 'The Accents'];
// The 4-step dressing formula's role names (Look Template spec A3) — the
// canonical set every generator casts per piece. Daily's legacy step title
// "The Accents" folds into "The Exclamation Point" client-side; Travel's
// TRAVEL_ROLES aliases this list.
const FORMULA_ROLES = ['The Anchor', 'The Canvas', 'The Texture', 'The Exclamation Point'];

// ── Look tags — the intelligence layer (Look Template spec F, 2026-08-07) ──
// Four axes filed on the LOOK, not the piece: thermal climate (never
// calendar months), light, real-world agenda (max two), and an optional
// silhouette/aesthetic vibe. Generated looks arrive tagged from the
// prompt's intent; hand-built looks inherit from their pieces client-side.
// The vocabularies are deliberately disjoint across axes so a flat text[]
// (the looks table's existing `tags` column) recovers its structure.
// ADR-002 rewrote all four axes. Climate speaks the same three bands as
// `wardrobe_items.season_band` so a filtered lookbook and a filtered wardrobe
// return coherent sets; wear_for is the shared seven-seed namespace, uncapped;
// vibe is an OPEN vocabulary lifted from her own words; Light is gone.
const LOOK_TAG_CLIMATES = ['spring_summer', 'autumn_winter', 'year_round'];
// The legacy four, kept ONLY to read blobs saved before ADR-002 — every
// lookbook artifact written before 2026-08-12 carries one of these in
// data.look_tags.climate. Never emitted.
const LOOK_TAG_CLIMATE_LEGACY = {
  'High Summer': 'spring_summer', 'Transitional Warm': 'spring_summer',
  'Transitional Cool': 'autumn_winter', 'Deep Winter': 'autumn_winter',
};
const LOOK_TAG_WEAR = ['everyday', 'work', 'evening', 'occasion', 'travel', 'active', 'lounge'];
// Legacy look-level vocabulary -> the shared seeds (ADR-002 migration table).
const LOOK_TAG_WEAR_LEGACY = {
  'Elevated Everyday': ['everyday'], 'Smart Creative': ['work'], 'Boardroom Power': ['work'],
  'Work-to-Dinner': ['work', 'evening'], 'Al Fresco & Travel': ['travel'],
  'Cocktail & Cultural': ['evening'], 'Formal / Gala': ['occasion'],
};
const LOOK_TAGS_SCHEMA = {
  type: 'object',
  properties: {
    climate: { type: 'string', enum: LOOK_TAG_CLIMATES },
    wear_for: { type: 'array', items: { type: 'string', enum: LOOK_TAG_WEAR } },
    // vibe is now free text, not an enum — it is her voice, and a fixed list
    // was a taxonomy standing in for something open-ended (ADR-002 §3).
    // Still OPTIONAL: "no vibe" is expressed by omitting the field. NEVER put
    // '' in any enum here — Gemini rejects empty enum values with 400
    // INVALID_ARGUMENT, which killed EVERY /api/daily and travel generation
    // (beta outage 2026-08-10). That is why `light` was removed from
    // `required` rather than given an empty option.
    vibe: { type: 'array', items: { type: 'string' } },
  },
  required: ['climate', 'wear_for'],
};
// The ten starting vibes (Look Rules 1e, 2026-08-17). A vibe is how she
// wants to FEEL and belongs to the look; the occasion is where she is going
// and belongs to the day. Exactly one vibe per look — stacking them makes
// the wear data unreadable. She can add her own, so this is a starting
// vocabulary the client may extend per request, never a closed enum.
const LOOK_TAG_VIBE_SEEDS = ['powerhouse', 'chic', 'undone', 'polished', 'easy',
  'romantic', 'sharp', 'quiet', 'statement', 'off-duty'];
// Her own set, when the client sends one — so "powerhouse", "power CEO" and
// "boss" all land on the one tag she already has rather than minting a third.
function vibeVocabLine(vibes) {
  const set = (Array.isArray(vibes) ? vibes : [])
    .map(v => String(v || '').trim().toLowerCase()).filter(Boolean).slice(0, 40);
  const list = set.length ? set : LOOK_TAG_VIBE_SEEDS;
  return `HER VIBE SET (map to exactly one of these wherever the brief's mood language reaches one of them, matching on meaning not spelling — "power CEO", "powerhouse" and "boss" are all the one tag): ${list.join(', ')}.`;
}
const LOOK_TAGS_RULE = `- "look_tags" files the look for search — assign from the brief's intent and the pieces, never leave it generic. "climate" is thermal, not calendar, and is one of exactly three: "spring_summer" (lightweight, single-layer, warm weather), "autumn_winter" (layered, knits and coats, cold weather), "year_round" (reads correctly in any weather). "wear_for" is the lifestyle occasions the look is FOR — one or two of everyday, work, evening, occasion, travel, active, lounge; the sharpest matches only, never all of them. "vibe" is how she wants to FEEL in the look, and there is EXACTLY ONE — an array of a single short lowercase word. Read it from her own mood language in the brief ("I want to feel like a powerhouse CEO on Thursday" -> ["powerhouse"]) and map that onto her vibe set below wherever one of them carries the same meaning. Coin a new single word only when nothing in her set fits, and omit the field entirely rather than reaching. Never emit two.
${vibeVocabLine(null)}`;
function normLookTags(t) {
  t = t && typeof t === 'object' ? t : {};
  const climate = LOOK_TAG_CLIMATES.includes(t.climate) ? t.climate
    : (LOOK_TAG_CLIMATE_LEGACY[t.climate] || '');
  // Accept the legacy look vocabulary on read so a re-normalised old blob
  // folds onto the shared seeds instead of losing its tags.
  const wear = [];
  (Array.isArray(t.wear_for) ? t.wear_for : []).forEach(w => {
    const mapped = LOOK_TAG_WEAR.includes(w) ? [w] : (LOOK_TAG_WEAR_LEGACY[w] || []);
    mapped.forEach(m => { if (!wear.includes(m)) wear.push(m); });
  });
  // wear_for stays uncapped (ADR-002 §4): a cap forces a choice between a
  // functional tag and a capsule tag, which is the choice that stops capsules
  // forming. 8 is a runaway guard, not a product limit.
  // vibe is capped at ONE (Look Rules 1e) — a look sits in one bucket or the
  // wear data cannot answer "which vibe do you actually wear".
  const vibeRaw = Array.isArray(t.vibe) ? t.vibe : (t.vibe ? [t.vibe] : []);
  const vibe = vibeRaw
    .map(v => String(v || '').replace(/^vibe:/i, '').trim().slice(0, 28))
    .filter(Boolean).slice(0, 1);
  return { climate, wear_for: wear.slice(0, 8), vibe };
}

// Build 3 copy rules (Tranche 2) — installed once and interpolated into
// every stylist prompt so Daily/Travel speak in one register. The
// failure pattern the audit found is always the same: copy that justifies
// a piece instead of describing it. These rules replace that instinct with
// two distinct jobs — a row note (the physical adjustment) and a panel
// note (the look's logic) — and a banned-construction list pulled from the
// actual audited output, not hypotheticals.
const BANNED_CONSTRUCTIONS_RULE = `BANNED CONSTRUCTIONS — never use these, in any field: the construction "X yet Y" (e.g. "comfortable yet refined"); benefit justification ("perfect for", "ideal for", "suitable for", "great for", "keeping you comfortable"); machine connectives ("ensuring", "while maintaining", "creating a", "allowing for", "centers around"); adverb inflation ("effortlessly", "seamlessly", "timelessly", "meticulously"); dead adjectives ("elevated", "versatile", "polished aesthetic", "vibrant spirit"); sustainability or virtue framing of any kind; quotation marks.`;

const ROW_NOTE_RULE = `ROW NOTE: one sentence, 6–12 words maximum. Describes how THIS piece is worn in THIS look — the physical adjustment a stylist makes with her hands, not the reason for it. Verb-led; start with a participle where natural — Worn, Tucked, Belted, Cuffed, Carried, Layered, Left, Buttoned. Never state why the piece is good, who it suits, or what it achieves. Never repeat the item's name — the rack already names it. Never begin with "Perfect", "Ideal", "Great" or "A". Write for a woman who already has taste; she does not need convincing. Examples: "Worn open, sleeves cuffed once above the wrist." / "Belted at the natural waist, not the hip." / "Cuffed once at the ankle to show the shoe."`;

const PANEL_NOTE_RULE = `PANEL NOTE: 30 words maximum, one or two sentences. Describes the logic of the look — how it balances, what register it sits in, what the weather or occasion asked for. Name garments by TYPE only (the wool, the knit, flat leather) — never list the pieces in order or name internal framework/formula steps; the rack already names them, with prices. Warm, direct and finished — she has been dressed, not sold to.`;

const WEEK_SUMMARY_RULE = `WEEK SUMMARY: 40 words maximum. Describes the week's register, weather and shape only — it covers up to seven days and still should not inventory them. Names no specific garment, so it can't go stale after she later swaps or restyles a day.`;

const DAILY_SCHEMA = {
  type: 'object',
  properties: {
    fallback: { type: 'boolean' },
    occasion_label: { type: 'string' },
    headline: { type: 'string' },
    stylist_summary: { type: 'string' },
    transition_tip: { type: 'string' },
    palette: { type: 'array', items: { type: 'string' } },
    look_tags: LOOK_TAGS_SCHEMA,
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', enum: DAILY_STEP_TITLES },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                category: { type: 'string', enum: ['Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Bags', 'Accessories', 'Other'] },
                brand: { type: 'string' },
                description: { type: 'string' },
                how: { type: 'string' },
                wardrobe_index: { type: 'integer' },
                retailer_hint: { type: 'string' },
                price_point: { type: 'string' },
                alternates: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      brand: { type: 'string' },
                      retailer_hint: { type: 'string' },
                      price_point: { type: 'string' },
                    },
                    required: ['name', 'brand', 'retailer_hint', 'price_point'],
                  },
                },
              },
              required: ['name', 'category', 'brand', 'how', 'wardrobe_index', 'retailer_hint', 'price_point', 'alternates'],
            },
          },
        },
        required: ['title', 'items'],
      },
    },
  },
  required: ['fallback', 'occasion_label', 'headline', 'stylist_summary', 'transition_tip', 'palette', 'look_tags', 'steps'],
};

app.post('/api/daily', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  // noImages: composition-only — the caller already has imagery for this
  // look (e.g. building a Look entity from a styled key piece reuses the
  // kp result's frames), so no image job is started and no jobId returned.
  const { prompt, name, styleDna, styleIcons, wardrobeItems, context: rtContext, locked, gender, vibes, noImages } = req.body;
  const g = normGender(gender);

  const closetItems = Array.isArray(wardrobeItems) ? wardrobeItems.slice(0, 60) : [];
  const n = closetItems.length;
  const dnaBlock = styleDnaPromptBlock(styleDna, n, styleIcons);

  // Anchored pieces (restyle flow) — items the user has locked into the
  // look. They must survive a restyle untouched; everything else re-mixes.
  const lockedList = (Array.isArray(locked) ? locked : [])
    .filter(l => l && l.name)
    .slice(0, 8)
    .map(l => {
      const idx = l.wardrobe_id != null ? closetItems.findIndex(it => String(it.id) === String(l.wardrobe_id)) : -1;
      return { name: String(l.name).slice(0, 120), category: l.category || '', brand: l.brand || '', idx };
    });
  const lockedBlock = lockedList.length
    ? `ANCHORED PIECES — the user has LOCKED these into today's look. Every one of them MUST appear in the final look exactly as given (same piece, same name), placed in the architectural step where it belongs; restyle everything AROUND them:\n${lockedList.map(l =>
        `- ${l.name}${l.category ? ' [' + l.category + ']' : ''}${l.brand ? ', ' + l.brand : ''}${l.idx >= 0 ? ` (wardrobe index ${l.idx} — set its wardrobe_index)` : ''}`
      ).join('\n')}`
    : '';

  const closetBlock = n
    ? `THE USER'S DIGITISED WARDROBE (${n} pieces, referenced by index):\n${closetItems.map((i, idx) =>
        `${idx}: ${i.label}${i.category ? ' [' + i.category + ']' : ''}${i.color ? ', ' + i.color : ''}${i.brand ? ', ' + i.brand : ''}${Number(i.times_worn) > 0 ? `, worn ${i.times_worn}×` : ''}${heroMark(i)}`
      ).join('\n')}`
    : 'THE USER HAS NOT CATALOGUED ANY WARDROBE PIECES YET.';
  const heroBlock = heroDirective(closetItems);

  const stateDirective = n === 0
    ? `WARDROBE STATE: EMPTY. Build a fully aspirational, editorial look — this look doubles as a shopping brief. Every item gets "wardrobe_index": -1 plus a real "retailer_hint" and "price_point".`
    : n < 15
      ? `WARDROBE STATE: GROWING (${n}/15). Hybrid build: wherever an owned piece genuinely serves the brief, use it — set its "wardrobe_index" and use its exact label as the name. Fill true gaps with aspirational pieces (wardrobe_index -1, real retailer_hint + price_point). When an owned piece and a hypothetical piece would both work, ALWAYS choose the owned piece.`
      : `WARDROBE STATE: COMPLETE (${n} pieces). Closet-first build: compose the look primarily from the digitised wardrobe — nearly every item should carry a valid "wardrobe_index" and its exact owned label. Introduce a new piece (wardrobe_index -1) only for a true gap or the finishing exclamation point.`;

  const rtLine = rtContext && (rtContext.city || rtContext.tempRange)
    ? `REAL-TIME CONTEXT: ${[rtContext.city, rtContext.month].filter(Boolean).join(' · ')}${rtContext.tempRange ? ' | ' + rtContext.tempRange : ''}${rtContext.condition ? ' | ' + rtContext.condition : ''}. This is the atmospheric reality — fabric weight, layers and footwear must answer to it.`
    : '';

  const systemInstruction = `You are Robes' head stylist — elite, editorial, precise. ${name ? `The user's name is ${name}. ` : ''}${genderDirective(g)} You dress clients for real days using the Context-to-Core Framework. Never output a generic outfit — name exact cuts, fabrications and styling techniques (e.g. "French-tuck a heavyweight silk button-down into high-waisted wide-leg wool trousers").

THE FRAMEWORK — work through it in this order:
1. THE CONTEXT FILTERS. Fix the day's parameters before pulling a single garment: the agenda & mobility in the brief (what she physically does today), the atmospheric reality (the real-time weather provided — it dictates fabric weight and outerwear), and the psychological goal (how she needs to feel and be perceived).
2. THE ARCHITECTURAL FORMULA. Build the outfit as exactly four steps, in this exact order:
   - "The Anchor" — exactly 1 item: the hero structural piece that sets the register (blazer, coat, statement skirt, dress).
   - "The Canvas" — 1 or 2 items: the supporting, high-quality basics beneath the anchor (shirt, tee, knit, trousers, skirt).
   - "The Texture" — exactly 1 item: the layering element that adds tactile dimension (scarf, cardigan, fine knit, belt).
   - "The Accents" — exactly 2 items: the definitive footwear plus one piece of hardware (bag, jewellery) that finish the look.
3. THE GOLDEN RATIOS. Balance the build through body architecture: the Rule of Thirds (never a 50/50 visual split — aim for 1/3 : 2/3, e.g. a high-waisted trouser with a tucked-in top lengthens the leg line), Volume Balancing (an oversized or voluminous piece demands a point of structure or compression elsewhere), and Textural Contrast (mix matte, sheen and rough — silk + wool + leather — so the look never falls flat). Let this thinking show in the stylist_summary and item descriptions.
4. THE TRANSITION PROTOCOL. She moves between environments without going home. "transition_tip" is ONE concrete move — subtractive styling (drop a layer to lower the formality) or hardware swapping (daytime tote + sneakers → clutch + kitten heel) — that shifts today's look into its next scene.

${stateDirective}${heroBlock ? '\n\n' + heroBlock : ''}${lockedBlock ? '\n\n' + lockedBlock : ''}

FIELD RULES:
- "occasion_label": 1–3 words, sentence case, naming the day's occasion (e.g. "Garden party", "Studio day").
- "headline": a short serif-worthy line naming place and occasion, sentence case, ending in a full stop (e.g. "A Dublin garden-party look."). Max 8 words.
- "stylist_summary" is this look's PANEL NOTE. ${PANEL_NOTE_RULE}
- "palette": exactly 3 hex colours drawn from the look, ordered neutral to accent.
- Each item: "name" is the piece itself (e.g. "Cream check blazer"); "brand" is ONE real brand suited to the piece's register (for owned pieces, the owned brand or ""); "description" is one internal reference sentence — cut, fabric, colour — used only to generate its photograph, never shown to her.
- "how" is this item's ROW NOTE. ${ROW_NOTE_RULE}
- Owned pieces: set "wardrobe_index" to the wardrobe list index, use the exact owned label as the name, and set retailer_hint and price_point to "". New pieces: "wardrobe_index": -1 with a real "retailer_hint" (e.g. "COS", "Net-a-Porter", "Arket") and a realistic EUR "price_point" (e.g. "€89").
- "alternates": exactly 2 per item — similar-but-distinct options for the SAME slot (a different colour, fabrication or register that still honours the palette, the weather and the DNA below), each with its own real brand, retailer_hint and EUR price_point. These power the flick-through rail, so make them genuinely wearable alternatives, never filler.
${LOOK_TAGS_RULE}
${vibeVocabLine(vibes)}
- "fallback": true ONLY if the brief is gibberish or random characters — then dress her for a pleasant, unremarkable day in the given context instead. A plain occasion, agenda or mood is a valid daily brief.${dnaBlock ? '\n\n' + dnaBlock : ''}

${BANNED_CONSTRUCTIONS_RULE}

${closetBlock}`;

  const userText = `${rtLine ? rtLine + '\n\n' : ''}The user's brief for today: "${(prompt || '').trim() || 'A regular day — no fixed plans.'}"

Dress her for this exact day, start to finish, through the four architectural steps.`;

  async function withRetry(fn, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); } catch (err) {
        if (i === attempts - 1) throw err;
        await new Promise(r => setTimeout(r, 800 * Math.pow(2, i)));
      }
    }
  }

  try {
    const t0 = Date.now();
    const textResponse = await withRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: DAILY_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 4800,
      },
    }));
    const parsed = deEscDeep(JSON.parse(textResponse.text));

    // Normalise: canonical step order, ≤2 items per step, wardrobe matching
    let steps = Array.isArray(parsed.steps)
      ? parsed.steps.filter(s => s && DAILY_STEP_TITLES.includes(s.title) && Array.isArray(s.items) && s.items.length)
      : [];
    steps.sort((a, b) => DAILY_STEP_TITLES.indexOf(a.title) - DAILY_STEP_TITLES.indexOf(b.title));
    const flat = [];
    steps.forEach(s => {
      s.items = s.items.slice(0, 2).map(it => {
        const wi = Number.isInteger(it.wardrobe_index) && it.wardrobe_index >= 0 ? closetItems[it.wardrobe_index] : null;
        it.wardrobe_match = wi
          ? { id: wi.id, label: wi.label, image_url: wi.image_url || null, color: wi.color || '' }
          : null;
        it.how = String(it.how || '').slice(0, 160);
        it.alternates = (Array.isArray(it.alternates) ? it.alternates : [])
          .filter(a => a && a.name)
          .slice(0, 3)
          .map(a => ({ name: String(a.name).slice(0, 120), brand: a.brand || '', retailer_hint: a.retailer_hint || '', price_point: a.price_point || '' }));
        it.image_index = flat.length;
        flat.push({ stepTitle: s.title, item: it });
        return it;
      });
    });
    if (!flat.length) throw new Error('empty daily look');
    const dailyOwnedCount = flat.filter(f => f.item.wardrobe_match).length;
    logAI({ feature: 'daily', stage: 'text', model: 'gemini-2.5-flash', ms: Date.now() - t0, items: flat.length, owned: dailyOwnedCount, fallback: parsed.fallback === true });
    // Composition (addendum to Tranche 2 Build 2): logAI only reaches
    // Railway's console, not the queryable generation_log table — the
    // owned-vs-total gate the original Build 2 brief asked for was
    // unanswerable because ownership never landed in `detail`. Write it
    // here alongside the text call's own automatically-logged row.
    (function () {
      const gctx = genCtx.getStore() || {};
      glog({
        user_id: gctx.userId || null,
        endpoint: '/api/daily',
        model: 'gemini-2.5-flash',
        status: 'ok',
        prompt: null,
        response: null,
        detail: { stage: 'composition', owned_count: dailyOwnedCount, item_count: flat.length, ...(gctx.genId ? { gen_id: gctx.genId } : {}) },
      });
    })();

    const jobId = noImages ? null : randomBytes(6).toString('hex');
    if (jobId) imageJobs.set(jobId, { images: flat.map(() => null), done: false, created: Date.now() });
    res.json({
      fallback: parsed.fallback === true,
      occasion_label: parsed.occasion_label || '',
      headline: parsed.headline || '',
      stylist_summary: parsed.stylist_summary || '',
      transition_tip: parsed.transition_tip || '',
      palette: Array.isArray(parsed.palette) ? parsed.palette.slice(0, 3) : [],
      look_tags: normLookTags(parsed.look_tags),
      steps,
      jobId: jobId || undefined,
      itemCount: flat.length,
    });
    if (noImages) return;

    // Background imagery — one frame per item, staggered under Gemini's
    // rate limit: the anchor gets the full-look editorial shot, everything
    // else a still-life. Only hosted URLs reach the client (lookbook-safe).
    const t1 = Date.now();
    const allNames = flat.map(f => f.item.name).join(', ');
    const scene = [parsed.occasion_label ? parsed.occasion_label.toLowerCase() : '', rtContext?.city].filter(Boolean).join(' in ');
    (async () => {
      // The anchor's full-look frame wears the kept model when one exists —
      // still-lifes stay garment-only (no figure to condition).
      const avatarRef = await avatarRefForUser(req.body.avatarId, req.body.userId, g);
      for (let i = 0; i < flat.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 3000));
        const { stepTitle, item } = flat[i];
        const anchorFrame = stepTitle === 'The Anchor';
        const imgPrompt = anchorFrame
          ? `PORTRAIT ORIENTATION ONLY. Single editorial fashion photograph — one ${wearerNoun(g)}, alone, one scene, no collage, no split panels, no text overlays. ${avatarRef ? AVATAR_IDENTITY : ''}${FULL_BODY_FRAME} ${styleIconsImageLine(styleIcons)}${wearerWears(g)} the complete outfit: ${allNames}. The ${item.name} leads the frame. ${scene ? `Setting: ${scene}. ` : ''}Soft natural light, luxury campaign aesthetic.`
          : `Editorial still-life photograph of a single ${item.name}${item.brand ? ' by ' + item.brand : ''} — ${item.description || ''}. The garment styled alone on a neutral cream-linen surface, soft daylight, quiet luxury catalogue aesthetic. No model, no text, no collage, one item only.`;
        const imgParts = anchorFrame && avatarRef
          ? [{ inlineData: { mimeType: avatarRef.mimeType, data: avatarRef.data } }, { text: imgPrompt }]
          : [{ text: imgPrompt }];
        try {
          const r = await Promise.race([
            ai.models.generateContent({
              model: 'gemini-3.1-flash-image',
              contents: [{ role: 'user', parts: imgParts }],
              config: { responseModalities: ['TEXT', 'IMAGE'] },
            }),
            new Promise(resolve => setTimeout(() => resolve(null), 50000)),
          ]);
          const part = r?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (!part?.inlineData) {
            logAI({ feature: 'daily', stage: 'image', index: i, success: false, reason: r ? 'no_inline_data' : 'timeout_50s' });
            continue;
          }
          const url = await cloudinaryUpload(part.inlineData.data, part.inlineData.mimeType);
          if (!url) {
            logAI({ feature: 'daily', stage: 'image', index: i, success: false, reason: 'cloudinary_failed' });
            continue;
          }
          logAI({ feature: 'daily', stage: 'image', index: i, success: true, ms: Date.now() - t1 });
          const job = imageJobs.get(jobId);
          if (job) job.images[i] = url;
        } catch (err) {
          logAI({ feature: 'daily', stage: 'image', index: i, success: false, reason: err.message });
        }
      }
      const job = imageJobs.get(jobId);
      if (job) job.done = true;
      logAI({ feature: 'daily', stage: 'images_complete', jobId, totalMs: Date.now() - t0 });
    })();
  } catch (err) {
    if (res.headersSent) return;
    logAI({ feature: 'daily', stage: 'text', success: false, reason: err.message });
    console.error('[daily] Gemini error:', err.message);
    res.status(500).json({ error: err.message || 'Daily look failed' });
  }
});

/* ── on-demand alternates (Tranche 2, Build 2) ───────────────────────── */
// Travel had no per-item AI alternates at all — its flick-through
// carousel (_dlOptions on the client) only ever offered owned
// same-category pieces. Generating 2 alternates per item upfront
// (like Daily does) would be a large schema/token cost across a full
// capsule for options that mostly never get viewed, so this is a
// narrow, cheap, single-item call fetched only when she engages with a
// piece (Swap) — never on render — and cached client-side per session.
// A narrow, well-scoped task like this doesn't need a frontier model;
// gemini-2.5-flash (thinking off) is the cheapest model already proven
// reliable on this API — see CLAUDE.md's Gemini model chain notes before
// ever trying a cheaper/smaller model that isn't already validated here.
// The model occasionally leaks a JSON-escaped code point as literal text
// ("\\u20ac135" rendered verbatim on a shop card, beta screenshot
// 2026-08-13) — one more decode pass turns a leaked escape back into its
// character and leaves ordinary text untouched.
function deEscUnicode(s) {
  return String(s || '').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
// The leak shows up across generators (a daily rack card read "\\u20ac110",
// a brand "Pol\\u00e8ne" — beta screenshot 2026-08-13), so every parsed
// payload gets one deep pass before normalisation. Strings only; shapes
// untouched.
function deEscDeep(v) {
  if (typeof v === 'string') return deEscUnicode(v);
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = deEscDeep(v[i]); return v; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = deEscDeep(v[k]); return v; }
  return v;
}

const ALTERNATES_SCHEMA = {
  type: 'object',
  properties: {
    alternates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          brand: { type: 'string' },
          retailer_hint: { type: 'string' },
          price_point: { type: 'string' },
          how: { type: 'string' },
        },
        required: ['name', 'brand', 'retailer_hint', 'price_point', 'how'],
      },
    },
  },
  required: ['alternates'],
};

// Still-life frames for pieces Robes PROPOSED but she doesn't own — the
// look builder's shop suggestions have no wardrobe photograph, so without
// these the rack thumbs and the look board sit empty. Same background job +
// polling contract as /api/travel: respond immediately with a jobId, upload
// each frame to Cloudinary, client polls GET /api/images/:jobId.
app.post('/api/lookbuild/images', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const pieces = (Array.isArray(req.body && req.body.pieces) ? req.body.pieces : [])
    .filter(p => p && typeof p.name === 'string' && p.name.trim())
    .slice(0, 4)
    .map(p => ({
      name: String(p.name).trim().slice(0, 120),
      brand: String(p.brand || '').trim().slice(0, 60),
      category: String(p.category || '').trim().slice(0, 40),
    }));
  if (!pieces.length) return res.status(400).json({ error: 'No pieces.' });

  const jobId = randomBytes(6).toString('hex');
  imageJobs.set(jobId, { images: pieces.map(() => null), done: false, created: Date.now() });
  res.json({ jobId, imageCount: pieces.length });

  const t0 = Date.now();
  (async () => {
    for (let f = 0; f < pieces.length; f++) {
      if (f > 0) await new Promise(r => setTimeout(r, 3000));
      const it = pieces[f];
      const imgPrompt = `Editorial still-life photograph of a single ${it.name}${it.brand ? ' by ' + it.brand : ''}${it.category ? ' (' + it.category + ')' : ''}. The piece styled alone on a neutral cream-linen surface, soft daylight, quiet luxury catalogue aesthetic. No model, no text, no collage, one item only.`;
      try {
        const r = await Promise.race([
          ai.models.generateContent({
            model: 'gemini-3.1-flash-image',
            contents: [{ role: 'user', parts: [{ text: imgPrompt }] }],
            config: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
          new Promise(resolve => setTimeout(() => resolve(null), 50000)),
        ]);
        const part = r?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!part?.inlineData) {
          logAI({ feature: 'lookbuild', stage: 'image', index: f, success: false, reason: r ? 'no_inline_data' : 'timeout_50s' });
          continue;
        }
        const url = await cloudinaryUpload(part.inlineData.data, part.inlineData.mimeType);
        if (!url) {
          logAI({ feature: 'lookbuild', stage: 'image', index: f, success: false, reason: 'cloudinary_failed' });
          continue;
        }
        logAI({ feature: 'lookbuild', stage: 'image', index: f, success: true, ms: Date.now() - t0 });
        const job = imageJobs.get(jobId);
        if (job) job.images[f] = url;
      } catch (err) {
        logAI({ feature: 'lookbuild', stage: 'image', index: f, success: false, reason: err.message });
      }
    }
    const job = imageJobs.get(jobId);
    if (job) job.done = true;
    logAI({ feature: 'lookbuild', stage: 'images_complete', jobId, totalMs: Date.now() - t0 });
  })();
});

app.post('/api/alternates', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const { item, context, styleDna, styleIcons, gender } = req.body;
  const g = normGender(gender);
  const itemName = String((item && item.name) || '').trim().slice(0, 120);
  if (!itemName) return res.status(400).json({ error: 'Missing item.' });
  const category = String((item && item.category) || '').trim().slice(0, 40);
  const brand = String((item && item.brand) || '').trim().slice(0, 60);
  const otherItems = (Array.isArray(context) ? context : [])
    .filter(s => typeof s === 'string' && s.trim())
    .slice(0, 8)
    .map(s => s.trim().slice(0, 80));
  const dnaBlock = styleDnaPromptBlock(styleDna, 0, styleIcons);

  const systemInstruction = `You are Robes' head stylist. ${genderDirective(g)} Suggest exactly 2 alternatives to ONE piece already in an existing look — similar-but-distinct options for the SAME slot (a different colour, fabrication or register that still honours the rest of the look), never a repeat of the original piece. Each needs a real brand suited to its register, a real "retailer_hint" (e.g. "COS", "Net-a-Porter", "Arket") and a realistic EUR "price_point" (e.g. "€89"). These power a flick-through rail, so make them genuinely wearable, never filler.
- "how" is this alternative's ROW NOTE. ${ROW_NOTE_RULE}

${BANNED_CONSTRUCTIONS_RULE}${dnaBlock ? '\n\n' + dnaBlock : ''}`;

  const userText = `THE PIECE TO REPLACE: ${itemName}${brand ? ' by ' + brand : ''}${category ? ' [' + category + ']' : ''}.
${otherItems.length ? `THE REST OF THIS LOOK (do not suggest these): ${otherItems.join(', ')}.\n` : ''}Suggest 2 alternatives for this exact slot.`;

  try {
    const t0 = Date.now();
    const r = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: ALTERNATES_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 500,
      },
    });
    const parsed = JSON.parse(r.text);
    const alternates = (Array.isArray(parsed.alternates) ? parsed.alternates : [])
      .filter(a => a && a.name && a.name.toLowerCase() !== itemName.toLowerCase())
      .slice(0, 2)
      .map(a => ({ name: deEscUnicode(String(a.name).slice(0, 120)), brand: deEscUnicode(a.brand || ''), retailer_hint: deEscUnicode(a.retailer_hint || ''), price_point: deEscUnicode(a.price_point || ''), how: deEscUnicode(String(a.how || '').slice(0, 160)) }));
    logAI({ feature: 'alternates', stage: 'text', model: 'gemini-2.5-flash', ms: Date.now() - t0, count: alternates.length });
    res.json({ alternates });
  } catch (err) {
    logAI({ feature: 'alternates', stage: 'text', success: false, reason: err.message });
    console.error('[alternates] Gemini error:', err.message);
    res.status(500).json({ error: err.message || 'Alternates failed' });
  }
});

/* ── look-builder stylist note (empty-state parity, 2026-08-13) ──────── */
// The client-side Robes build picks pieces deterministically (the fifth-pass
// decision stands: no LLM decides the pieces), but the assembled look was
// arriving mute — no panel note, no tags — where the prompt-built daily look
// speaks (Annie's discrepancy report). This is the "new lightweight endpoint"
// that decision flagged: it only WRITES ABOUT a look the client already
// built, in the same register as every other surface (PANEL_NOTE_RULE +
// LOOK_TAGS_RULE), on the same cheap model as /api/alternates.
const LOOKBUILD_NOTE_SCHEMA = {
  type: 'object',
  properties: {
    note: { type: 'string' },
    // The colour whisper under the mosaic — a fully-proposed build has no
    // owned pieces to read tones from, so the stylist names them.
    palette: { type: 'array', items: { type: 'string' } },
    look_tags: LOOK_TAGS_SCHEMA,
  },
  required: ['note', 'look_tags'],
};

app.post('/api/lookbuild/note', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const { pieces, styleDna, styleIcons, gender, vibes } = req.body;
  const g = normGender(gender);
  const list = (Array.isArray(pieces) ? pieces : [])
    .filter(p => p && typeof p.name === 'string' && p.name.trim())
    .slice(0, 8)
    .map(p => ({
      name: String(p.name).trim().slice(0, 120),
      role: String(p.role || '').trim().slice(0, 40),
      owned: !!p.owned,
    }));
  if (list.length < 2) return res.status(400).json({ error: 'Need at least 2 pieces.' });
  const dnaBlock = styleDnaPromptBlock(styleDna, 0, styleIcons);

  const systemInstruction = `You are Robes' head stylist. ${genderDirective(g)} A look has already been assembled — you are writing its note and filing it, never changing the pieces.
- "note" is this look's PANEL NOTE. ${PANEL_NOTE_RULE}
- "palette" is 2–4 six-digit hex codes reading the look's colour story off the pieces as named — muted, true to the garments, never invented brights.
${LOOK_TAGS_RULE}
${vibeVocabLine(vibes)}

${BANNED_CONSTRUCTIONS_RULE}${dnaBlock ? '\n\n' + dnaBlock : ''}`;

  const userText = `THE LOOK, AS ASSEMBLED:\n${list.map(p =>
    `- ${p.name}${p.role ? ' [' + p.role + ']' : ''}${p.owned ? ' (her own piece)' : ' (proposed, not owned yet)'}`).join('\n')}
\nWrite the panel note and file the look.`;

  try {
    const t0 = Date.now();
    const r = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: LOOKBUILD_NOTE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 450,
      },
    });
    const parsed = deEscDeep(JSON.parse(r.text));
    const note = deEscUnicode(String(parsed.note || '').trim().slice(0, 300));
    const palette = (Array.isArray(parsed.palette) ? parsed.palette : [])
      .filter(h => typeof h === 'string' && /^#[0-9A-Fa-f]{6}$/.test(h.trim()))
      .map(h => h.trim()).slice(0, 4);
    logAI({ feature: 'lookbuild', stage: 'note', model: 'gemini-2.5-flash', ms: Date.now() - t0 });
    res.json({ note, palette, look_tags: normLookTags(parsed.look_tags) });
  } catch (err) {
    logAI({ feature: 'lookbuild', stage: 'note', success: false, reason: err.message });
    console.error('[lookbuild/note] Gemini error:', err.message);
    res.status(500).json({ error: err.message || 'Note failed' });
  }
});

/* ── intent classifier (Diary Phase 1 — the prompt as single entry) ── */
// Routes a free-typed prompt to a track. Structured JSON only; the two
// non-negotiables: it NEVER invents a destination or a date (a guessed
// "Ibiza" is the failure mode that destroys trust in the field), and
// relative dates resolve against the CLIENT's local calendar date, never
// server now(). Captured in generation_log via the wrapped ai client.
const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['daily', 'travel', 'unclear'] },
    destination: { type: 'string' },
    date_start: { type: 'string' },
    date_end: { type: 'string' },
    vibe: { type: 'string' },
    day_intents: {
      type: 'array',
      items: {
        type: 'object',
        properties: { date: { type: 'string' }, label: { type: 'string' } },
        required: ['date', 'label'],
      },
    },
    confidence: { type: 'number' },
  },
  required: ['intent', 'confidence'],
};

app.post('/api/intent', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const prompt = String(req.body.prompt || '').trim().slice(0, 400);
  if (!prompt) return res.status(400).json({ error: 'Empty prompt.' });
  const clientDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.clientDate || '')) ? req.body.clientDate : null;

  const systemInstruction = `You classify ONE styling prompt from a fashion app user into a track. Return JSON only.
TRACKS:
- "daily" — one outfit for one occasion or one day ("dinner tonight", "an outfit for Friday's interview").
- "travel" — a trip away: a destination, packing, a holiday, a stay ("pack for Ibiza", "a week in Rome", "my honeymoon").
- "unclear" — none of the above reads confidently. A multi-day plan at home with no trip ("plan my work week") is "unclear" — the app will ask her how to route it.
A named trip outranks the occasions inside it ("dinners on my Lisbon trip" → travel).
HARD RULES — breaking these is worse than "unclear":
1. NEVER invent a destination. "destination" is filled ONLY with a place the user actually wrote. "Somewhere warm" is NOT a destination — leave it empty.
2. NEVER invent dates. Fill "date_start"/"date_end" (ISO YYYY-MM-DD) ONLY when the prompt states them explicitly ("4–11 Aug") or relatively resolvable ("next week", "this weekend") against TODAY, which is ${clientDate || 'unknown — in that case emit NO dates at all'} in the user's own timezone. A season or vague future ("in September", "soon") fills nothing.
3. "day_intents": only when the prompt names specific activities on resolvable specific days ("Friday is a client dinner") — one entry per stated day, label in her words. Never padded.
4. "vibe": the styling mood/aesthetic the prompt itself carries, as a short phrase in her register ("refined Mediterranean", "quiet luxury", "festival-ready") — ONLY what the prompt states or strongly implies, never invented. Empty when she gave none.
5. "confidence" 0–1: how sure you are of the track. Below 0.6 means the app will ask her instead of acting.
Leave any unknown string field as an empty string.`;

  try {
    const t0 = Date.now();
    const r = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: `THE PROMPT: "${prompt}"` }] }],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: INTENT_SCHEMA,
          temperature: 0,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 500,
        },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('intent timeout')), 5000)),
    ]);
    const parsed = JSON.parse(r.text);
    const isoOk = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const out = {
      intent: ['daily', 'travel', 'unclear'].includes(parsed.intent) ? parsed.intent : 'unclear',
      destination: String(parsed.destination || '').trim().slice(0, 60) || null,
      date_start: isoOk(parsed.date_start) ? parsed.date_start : null,
      date_end: isoOk(parsed.date_end) ? parsed.date_end : null,
      day_intents: (Array.isArray(parsed.day_intents) ? parsed.day_intents : [])
        .filter(d => d && isoOk(d.date) && d.label)
        .slice(0, 14)
        .map(d => ({ date: d.date, label: String(d.label).slice(0, 120) })),
      vibe: String(parsed.vibe || '').trim().slice(0, 120) || null,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    };
    if (out.date_start && out.date_end && out.date_end < out.date_start) {
      const t = out.date_start; out.date_start = out.date_end; out.date_end = t;
    }
    logAI({ feature: 'intent', stage: 'text', model: 'gemini-2.5-flash', ms: Date.now() - t0, intent: out.intent, confidence: out.confidence });
    res.json(out);
  } catch (err) {
    logAI({ feature: 'intent', stage: 'text', success: false, reason: err.message });
    console.error('[intent] classify error:', err.message);
    res.status(502).json({ error: 'intent_failed' });
  }
});

// Hero Rack: the client marks starred pieces with hero: true and the piece's
// season band. The closet lines carry a ★ HERO mark and this directive makes
// them the first-choice owned pieces wherever occasion + season fit.
//
// ADR-002: reads `season_band` (one of three), falling back to the legacy
// `seasons[]` array so a client that has not yet been updated — or a cached
// payload from one — still marks its heroes correctly.
const SEASON_BAND_LABELS = {
  spring_summer: 'Spring/Summer', autumn_winter: 'Autumn/Winter', year_round: 'Year-round',
};
function heroMark(i) {
  if (!i || i.hero !== true) return '';
  const band = SEASON_BAND_LABELS[i.season_band]
    || (Array.isArray(i.seasons) && i.seasons.length
      ? i.seasons.filter(s => typeof s === 'string' && s).slice(0, 5).join('/')
      : 'Year-round');
  return `, ★ HERO (${band})`;
}
function heroDirective(closetItems) {
  if (!closetItems.some(i => i && i.hero === true)) return '';
  return `HERO PIECES: the wardrobe items marked ★ HERO are her Hero Rack — the pieces she reaches for first, the spine of her wardrobe. Whenever a hero piece genuinely suits the occasion AND the season/climate in play, PRIORITISE it over any other comparable owned piece and let it lead the look. The bracket names the season band each hero belongs to — Spring/Summer, Autumn/Winter, or Year-round. Its priority only applies when the look's season or climate matches that band (Year-round always matches); never force an off-season hero into a look.`;
}

/* ── travel edit (PRD: AI-Powered Capsule Packing & Lookbook,
      looks-first revision 2026-07-30: "start with outfits, not pieces") ── */
// The trip is built around LOOKS, not days: the user names the trip's
// high-level plans (Night out, Beach day, Pilates…), picks any finished
// looks she's packing whole and the key pieces that must be in the case;
// Robes styles one flat, day-agnostic look per plan — the client pins
// looks to calendar days afterwards. The capsule stays curatorial: Keep
// (every key piece, with a reason) + Worth Adding (genuine gaps only,
// the smallest group, may be empty). The pack count is an OUTPUT of the
// 1:3 rule + trip length, not a user input; every look is a 4-step
// formula referencing capsule items by index; the 1:3 rule is validated
// server-side with one corrective regeneration. Weather for the
// destination + date window is fetched here (FR-101), not on the
// client — the client's weather strip is the user's current city.
const TRAVEL_TIERS = ['Foundations & Tailoring', 'Statement & Texture', 'Footwear & Hardware'];
const TRAVEL_ROLES = FORMULA_ROLES;

const TRAVEL_SCHEMA = {
  type: 'object',
  properties: {
    fallback: { type: 'boolean' },
    trip_label: { type: 'string' },
    headline: { type: 'string' },
    location_vibe: { type: 'string' },
    stylist_summary: { type: 'string' },
    suitcase_note: { type: 'string' },
    palette: { type: 'array', items: { type: 'string' } },
    capsule: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tier: { type: 'string', enum: TRAVEL_TIERS },
          category: { type: 'string', enum: ['Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Bags', 'Accessories', 'Swim', 'Other'] },
          brand: { type: 'string' },
          description: { type: 'string' },
          reason: { type: 'string' },
          bridge: { type: 'string' },
          wardrobe_index: { type: 'integer' },
          retailer_hint: { type: 'string' },
          price_point: { type: 'string' },
        },
        required: ['name', 'tier', 'category', 'brand', 'description', 'wardrobe_index', 'retailer_hint', 'price_point'],
      },
    },
    left_behind: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          wardrobe_index: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['wardrobe_index', 'reason'],
      },
    },
    looks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          occasion: { type: 'string' },
          title: { type: 'string' },
          how: { type: 'string' },
          look_tags: LOOK_TAGS_SCHEMA,
          formula: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: TRAVEL_ROLES },
                item_index: { type: 'integer' },
                note: { type: 'string' },
              },
              required: ['role', 'item_index', 'note'],
            },
          },
        },
        required: ['occasion', 'title', 'how', 'look_tags', 'formula'],
      },
    },
  },
  required: ['fallback', 'trip_label', 'headline', 'location_vibe', 'stylist_summary', 'suitcase_note', 'palette', 'capsule', 'left_behind', 'looks'],
};

const WX_CODE_TEXT = [
  [0, 'clear skies'], [1, 'mostly clear'], [2, 'partly cloudy'], [3, 'overcast'],
  [45, 'foggy'], [51, 'light drizzle'], [61, 'rain'], [71, 'snow'], [80, 'passing showers'], [95, 'thunderstorms'],
];
function wxCondition(code) {
  if (!Number.isFinite(code)) return '';
  let text = '';
  for (const [c, t] of WX_CODE_TEXT) { if (code >= c) text = t; }
  return text;
}

async function fetchJson(url, ms = 6000) {
  const r = await Promise.race([
    fetch(url),
    new Promise((_, rej) => setTimeout(() => rej(new Error('weather timeout')), ms)),
  ]);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// FR-101: geocode the destination, then real forecast when the window is
// inside Open-Meteo's 16-day horizon, else last year's same dates as a
// seasonal read. Any failure returns null — the trip still generates.
async function fetchTripWeather(destination, dateFrom, dateTo) {
  try {
    const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(destination)}&count=1&language=en`);
    const loc = geo?.results?.[0];
    if (!loc) return null;
    const base = { city: loc.name, country: loc.country || '' };
    const from = new Date(dateFrom + 'T00:00:00Z');
    const to = new Date(dateTo + 'T00:00:00Z');
    if (isNaN(from) || isNaN(to)) return base;
    const daily = 'temperature_2m_max,temperature_2m_min,weather_code';
    const shift = d => { const x = new Date(d); x.setUTCFullYear(x.getUTCFullYear() - 1); return x.toISOString().slice(0, 10); };
    const liveUrl = () => `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=${daily}&start_date=${dateFrom}&end_date=${dateTo}&temperature_unit=celsius`;
    const archiveUrl = () => `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=${daily}&start_date=${shift(from)}&end_date=${shift(to)}&temperature_unit=celsius`;

    // Live forecast when the trip STARTS inside Open-Meteo's ~16-day horizon
    // (and hasn't already begun), else last year's same dates as a seasonal
    // read. Try the primary source, and if it comes back empty fall through
    // to the other one before giving up — the pill always gets a real
    // forecast OR a seasonal average whenever geocoding succeeds.
    const daysToStart = Math.round((from - Date.now()) / 86400000);
    const useLive = daysToStart >= -1 && daysToStart <= 16;
    const plan = useLive
      ? [{ url: liveUrl, seasonal: false }, { url: archiveUrl, seasonal: true }]
      : [{ url: archiveUrl, seasonal: true }, { url: liveUrl, seasonal: false }];

    for (const step of plan) {
      let data;
      try { data = await fetchJson(step.url()); } catch { continue; }
      const maxes = (data?.daily?.temperature_2m_max || []).filter(Number.isFinite);
      const mins = (data?.daily?.temperature_2m_min || []).filter(Number.isFinite);
      const codes = (data?.daily?.weather_code || []).filter(Number.isFinite);
      if (!maxes.length || !mins.length) continue;
      const counts = new Map();
      codes.forEach(c => counts.set(c, (counts.get(c) || 0) + 1));
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        ...base,
        minC: Math.round(Math.min(...mins)),
        maxC: Math.round(Math.max(...maxes)),
        tempRange: `${Math.round(Math.min(...mins))}–${Math.round(Math.max(...maxes))}°C`,
        condition: wxCondition(dominant),
        eveningMinC: Math.round(Math.min(...mins)),
        seasonal: step.seasonal,
      };
    }
    return base;
  } catch (err) {
    logAI({ feature: 'travel', stage: 'weather', success: false, reason: err.message });
    return null;
  }
}

// Validates the 1:3 rule — returns capsule indexes worn in fewer than
// three looks (only meaningful when the lookbook itself is non-trivial).
function travelUnderusedItems(capsule, looks) {
  const uses = capsule.map(() => 0);
  looks.forEach(l => {
    const seen = new Set();
    (l.formula || []).forEach(f => {
      if (Number.isInteger(f.item_index) && f.item_index >= 0 && f.item_index < capsule.length && !seen.has(f.item_index)) {
        seen.add(f.item_index);
        uses[f.item_index]++;
      }
    });
  });
  if (looks.length < 6) return [];
  return uses.map((u, i) => ({ i, u })).filter(x => x.u < 3).map(x => x.i);
}

app.post('/api/travel', rateLimit({ windowMs: 60_000, max: 6 }), async (req, res) => {
  const { destination, dateFrom, dateTo, brief, vibe, plans, coveredPlans, importedLooks, name, styleDna, styleIcons, wardrobeItems, shortlistIds, anchorIds, gender } = req.body;
  const g = normGender(gender);
  if (!destination || !String(destination).trim()) {
    return res.status(400).json({ error: 'Tell us where you’re going first.' });
  }

  const dest = String(destination).trim().slice(0, 120);
  const closetItems = Array.isArray(wardrobeItems) ? wardrobeItems.slice(0, 60) : [];
  const n = closetItems.length;
  const dnaBlock = styleDnaPromptBlock(styleDna, n, styleIcons);

  // The key pieces — everything that MUST be in the case, multi-selected
  // from her catalogued wardrobe. Every key piece is KEPT — "Leave
  // Behind" is deprecated (beta feedback: cutting her own picks read as
  // illogical without a real packing-restriction engine); Robes' job is
  // the wear-map + true gaps. (`anchorIds` accepted for back-compat.)
  const shortIdxs = (Array.isArray(shortlistIds) ? shortlistIds : (Array.isArray(anchorIds) ? anchorIds : []))
    .map(id => closetItems.findIndex(it => String(it.id) === String(id)))
    .filter(i => i >= 0);

  // Moodboard handoff ("Pack this trip" from a board): unowned board pieces
  // ride along and land in Worth Adding — she chose them already.
  const suggestedItems = (Array.isArray(req.body.suggestedItems) ? req.body.suggestedItems : [])
    .filter(s => s && s.name)
    .slice(0, 12)
    .map(s => ({
      name: String(s.name).slice(0, 120),
      category: s.category ? String(s.category).slice(0, 24) : '',
      brand: s.brand ? String(s.brand).slice(0, 60) : '',
      retailer_hint: s.retailer_hint ? String(s.retailer_hint).slice(0, 60) : '',
      price_point: s.price_point ? String(s.price_point).slice(0, 20) : '',
    }));

  // The capsule normally caps at 16, but every shortlisted piece is kept and
  // every moodboard pick joins Worth Adding — the cap must never force a
  // silent cut of something she chose herself.
  const capMax = Math.max(16, shortIdxs.length + suggestedItems.length + 3);

  const from = new Date(String(dateFrom || '') + 'T00:00:00Z');
  const to = new Date(String(dateTo || '') + 'T00:00:00Z');
  const validDates = !isNaN(from) && !isNaN(to) && to >= from;
  const tripDays = validDates ? Math.min(10, Math.round((to - from) / 86400000) + 1) : 7;
  const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dateLine = validDates ? `${fmt(from)} – ${fmt(to)}${from.getUTCFullYear() !== new Date().getUTCFullYear() ? ' ' + from.getUTCFullYear() : ''}` : '';
  const monthName = validDates ? from.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }) : '';

  const weather = validDates ? await fetchTripWeather(dest, String(dateFrom), String(dateTo)) : await fetchTripWeather(dest, '', '');

  // The high-level plans (looks-first UX 2026-07-30): the trip's moments
  // in her own labels — "Night in", "Night out", "Beach day", "Pilates".
  // Looks are built AROUND these, flat and day-agnostic; she pins them to
  // calendar days on the client afterwards.
  // Plans she has already mapped to a saved look of her own (client
  // planMap): the case still dresses them, but NO new look is styled for
  // them — her look renders under that occasion client-side.
  const coveredList = (Array.isArray(coveredPlans) ? coveredPlans : [])
    .filter(p => typeof p === 'string' && p.trim())
    .map(p => p.trim().slice(0, 60))
    .slice(0, 10);
  const planList = (Array.isArray(plans) ? plans : [])
    .filter(p => typeof p === 'string' && p.trim())
    .map(p => p.trim().slice(0, 60))
    .filter(p => !coveredList.some(c => c.toLowerCase() === p.toLowerCase()))
    .slice(0, 10);
  const vibeLine = String(vibe || '').trim().slice(0, 240);

  // Finished looks she's packing whole (Look entities / lookbook) —
  // context only: their owned pieces arrive via shortlistIds, and the
  // client renders the looks themselves. The model packs AROUND them,
  // never re-styles them.
  const packedLooks = (Array.isArray(importedLooks) ? importedLooks : [])
    .filter(l => l && l.title)
    .slice(0, 8)
    .map(l => ({
      title: String(l.title).slice(0, 120),
      occasion: typeof l.occasion === 'string' && l.occasion.trim() ? l.occasion.trim().slice(0, 60) : '',
      pieces: (Array.isArray(l.pieces) ? l.pieces : []).filter(p => typeof p === 'string' && p.trim()).map(p => p.trim().slice(0, 80)).slice(0, 8),
    }));

  const closetBlock = n
    ? `THE USER'S DIGITISED WARDROBE (${n} pieces, referenced by wardrobe_index):\n${closetItems.map((i, idx) =>
        `${idx}: ${i.label}${i.category ? ' [' + i.category + ']' : ''}${i.color ? ', ' + i.color : ''}${i.brand ? ', ' + i.brand : ''}${Number(i.times_worn) > 0 ? `, worn ${i.times_worn}×` : ''}${heroMark(i)}`
      ).join('\n')}`
    : 'THE USER HAS NOT CATALOGUED ANY WARDROBE PIECES YET.';
  // Trip hero priority answers to the DESTINATION's climate/season (the
  // micro-climate block + trip dates), not the user's current season
  const heroBlock = heroDirective(closetItems);

  // Only the shortlist-less legacy path needs a wardrobe-state directive —
  // with a shortlist the curatorial block below governs everything.
  const stateDirective = shortIdxs.length ? '' : (n === 0
    ? `WARDROBE STATE: EMPTY. Build a fully aspirational capsule — a curated shopping brief. Every item gets "wardrobe_index": -1 plus a real "retailer_hint" and "price_point". "left_behind" must be [].`
    : n < 15
      ? `WARDROBE STATE: GROWING (${n}/15). Hybrid capsule: wherever an owned piece genuinely serves the trip, use it — set its "wardrobe_index" and use its exact label as the name. Fill true gaps with editorially matched acquisitions (wardrobe_index -1, real retailer_hint + price_point). When an owned piece and a hypothetical piece would both work, ALWAYS pack the owned piece. "left_behind" must be [].`
      : `WARDROBE STATE: COMPLETE (${n} pieces). Closet-first capsule: pack primarily from the digitised wardrobe — most items should carry a valid "wardrobe_index" and their exact owned label. Suggest a new piece (wardrobe_index -1) only for a true gap the trip exposes. "left_behind" must be [].`);

  const wxLine = weather && weather.tempRange
    ? `MICRO-CLIMATE (${weather.seasonal ? 'seasonal average for these dates' : 'live forecast'}): ${weather.city}${weather.country ? ', ' + weather.country : ''} — daytime highs to ${weather.maxC}°C, evening lows to ${weather.minC}°C, mostly ${weather.condition || 'mixed conditions'}. Fabric weights, layers and evening cover-ups must answer to this.`
    : '';

  // The look count is derived. Named plans are authoritative: EXACTLY one
  // look per uncovered plan, never extras (UX feedback 2026-07-30 — 4
  // plans + 4 mapped looks used to yield 8). Only a plan-less trip falls
  // back to the trip-length heuristic; she pins looks to days herself, so
  // there is no day grid and no Day/Evening pair.
  const looksTarget = planList.length
    ? Math.min(12, planList.length)
    : (coveredList.length ? 0 : Math.min(12, Math.max(4, Math.min(tripDays + 2, 10))));
  // The 1:3 maths runs against every look that travels — generated AND
  // the ones she styled herself.
  const totalLooks = looksTarget + packedLooks.length;

  // The pack count is an output, not an input: the model derives it from
  // trip length + the 1:3 rule. `suggest` is soft guidance echoing the
  // PRD's 5/4/5 Ibiza reference architecture; 16 is the hard normalise cap.
  const suggest = Math.max(8, Math.min(15, tripDays + 6));
  const foundations = Math.round(suggest * 0.36);
  const statements = Math.round(suggest * 0.28);
  const hardware = suggest - foundations - statements;

  function travelSystem(correctiveNote) {
    return `You are Robes' head stylist — elite, editorial, precise. ${name ? `The user's name is ${name}. ` : ''}${genderDirective(g)} You are building a Capsule Packing Edit & Lookbook for a trip, governed by the StyleAlchemist 4-Core Pillars. Never output a generic outfit — ban flat phrasing ("jeans and a top"); render every look with high descriptive specificity (e.g. "Deep-V tuck the oversized alabaster silk button-down into the wide-leg linen trousers, cinched with the molten gold waist-belt").

THE PILLARS — all four are hard constraints:
1. THE 1:3 HIGH-YIELD RULE. Every capsule item must appear in AT LEAST THREE different outfits across the lookbook, in at least two distinct dress codes. No single-outfit passengers — if a piece can't earn three wears, it doesn't get packed.
2. THE CAPSULE MATRIX. YOU decide the pack count — the smallest capsule that dresses every moment of the trip under the 1:3 rule. For this ${tripDays}-day trip that is typically around ${suggest} items (never more than ${capMax}); the maths must hold: pieces × 3 wears ≥ ~${totalLooks} looks × ~4 formula slots (her own packed looks below count). Split the capsule across the three tiers: "${TRAVEL_TIERS[0]}" (~${foundations} items — architectural basics, tailoring, versatile one-pieces), "${TRAVEL_TIERS[1]}" (~${statements} items — the tactile hero pieces: statement dresses, crochet, plissé, prints), "${TRAVEL_TIERS[2]}" (~${hardware} items — shoes, bags, belts, jewellery that seal silhouettes).${shortIdxs.length ? ' The tier targets are guidance for shaping what you KEEP — never pad the capsule to hit a number.' : ''}
3. THE 4-STEP DRESSING FORMULA. Every outfit's "formula" is built ONLY from capsule items referenced by "item_index" (0-based index into the capsule array — never invent an item that isn't packed): "The Anchor" ×1 (the context-driven hero), "The Canvas" ×1–2 (the grounding basics), "The Texture" ×1 (the tactile dimension layer), "The Exclamation Point" ×1–2 (footwear/hardware that finish it). Swim or sleep-adjacent looks may drop to 3 entries, never fewer. Each entry's "note" is that piece's ROW NOTE. ${ROW_NOTE_RULE} ${LOOK_TAGS_RULE.replace(/^- /, 'Each look\'s ')}
4. CONTEXT ENGINEERING. Ingest three vectors at once: the Location Vibe (name it in "location_vibe", e.g. "Refined Mediterranean Minimalism"), the Micro-Climate provided, and the client's proportional architecture / style DNA below. Everything packed answers to all three.

${looksTarget === 0
  ? `THE LOOKS — every plan on this trip is already covered by a look she styled herself and is packing whole (listed below). Do NOT style any new looks: return "looks" as an EMPTY array []. The capsule is her packed looks' pieces plus her key pieces, and the 1:3 maths runs against the ${totalLooks} looks SHE brings.`
  : `THE LOOKS — a look is styled ONCE and worn wherever it suits; she pins each look to the days of her trip herself, so looks are FLAT and day-agnostic (no day numbers, no Day/Evening pairs, never mention a specific day). Return ${planList.length ? `EXACTLY ${looksTarget} look${looksTarget === 1 ? '' : 's'} in "looks" — one per plan below, dressed for exactly what it is, never an extra she didn't ask for` : `~${looksTarget} looks in "looks", built around the moments this trip plausibly holds`}. Each look: "occasion" (${planList.length ? 'EXACTLY one of her plan labels below' : 'a 1–3 word moment label like "Beach day" or "Night out"'}), "title" (a NAME for the look — 2–4 words in Title Case, never a sentence, never a trailing full stop; "Golden Hour", "Harbour Dinner" — NOT "Effortless exploration ensemble."), "how" (this look's PANEL NOTE) and the "formula". ${PANEL_NOTE_RULE}`}

${planList.length ? `HER PLANS — the trip's moments, in her own labels. AUTHORITATIVE: dress each plan for exactly what it is, and use the label verbatim as that look's "occasion":
${planList.map(p => `- ${p}`).join('\n')}

` : ''}${coveredList.length ? `OCCASIONS ALREADY COVERED BY HER OWN LOOKS — she mapped a look she already styled to each of these plans. NEVER style a look for a covered occasion; the capsule still dresses them through her packed looks below:
${coveredList.map(p => `- ${p}`).join('\n')}

` : ''}${packedLooks.length ? `LOOKS SHE HAS ALREADY STYLED AND IS PACKING WHOLE (do not re-style these — pack around them; their owned pieces are in the key-piece list and still count toward the 1:3 maths):
${packedLooks.map(l => `- "${l.title}"${l.occasion ? ` — covers her "${l.occasion}" plan` : ''}${l.pieces.length ? ': ' + l.pieces.join(', ') : ''}`).join('\n')}

` : ''}${[stateDirective, heroBlock].filter(Boolean).join('\n\n')}

FIELD RULES:
- "trip_label": destination + month, ALL CAPS (e.g. "IBIZA · JULY").
- "headline": a short serif-worthy line naming the trip, sentence case, full stop, max 9 words (e.g. "A week in Ibiza, packed once.").
- "stylist_summary": 2–3 sentences opening with the climate + vibe read, then how the capsule multiplies (reference the 1:3 maths — the pieces kept vs the ~${totalLooks} looks they earn).${shortIdxs.length ? ' Open by VALIDATING the strongest kept piece ("Your ' + closetItems[shortIdxs[0]].label.toLowerCase() + ' is exactly right for…") before describing what the edit unlocks.' : ''}
- "reason": for KEPT owned pieces — one warm, specific line on why it made the cut (the wears it earns, what it anchors). New pieces: "".
- "bridge": for NEW pieces only (wardrobe_index -1) — one clause naming what it connects in the capsule and how many looks it unlocks. Owned pieces: "".
- "suitcase_note": ONE practical packing move (rolling, garment bags, what flies in what) in stylist voice.
- "palette": exactly 3 hex colours the capsule is built on, neutral to accent.
- Capsule items: "name" is the piece (for owned pieces the exact owned label); "brand" ONE real brand (owned brand or ""); "description" one hyper-specific sentence — cut, fabrication, colour, why it earns its place. Owned: wardrobe_index set, retailer_hint and price_point "". New: wardrobe_index -1, real "retailer_hint" (e.g. "COS", "Net-a-Porter", "Arket") and realistic EUR "price_point" (e.g. "€145").
- "fallback": true ONLY if the destination/brief is gibberish — then pack for a pleasant week away somewhere temperate instead.${dnaBlock ? '\n\n' + dnaBlock : ''}

${BANNED_CONSTRUCTIONS_RULE}

${shortIdxs.length ? `HER KEY PIECES — everything that MUST be in the case (${shortIdxs.length} owned pieces, by wardrobe_index):
${shortIdxs.map(i => `${i}: ${closetItems[i].label}${closetItems[i].category ? ' [' + closetItems[i].category + ']' : ''}${closetItems[i].color ? ', ' + closetItems[i].color : ''}`).join('\n')}
KEEP EVERY SHORTLISTED PIECE — she has already decided what to bring; NEVER cut, drop or leave behind a shortlisted piece. Each one goes in "capsule" with its wardrobe_index, exact owned label and a one-line "reason" naming the wears it earns and what it anchors. "left_behind" must be []. Work every piece as hard as the 1:3 rule allows — a weaker piece still gets styled into the trip, not cut.
WORTH ADDING — the SMALLEST group, and it may be EMPTY: suggest a new piece (wardrobe_index -1, real retailer_hint + price_point) ONLY for a genuine gap the packed pieces expose that no shortlisted piece can fill. Never more than 3${suggestedItems.length ? ' beyond her moodboard picks below' : ''}. Every NEW piece must justify itself as a bridge: set its "bridge" field to one clause naming what it connects and how many looks it unlocks (e.g. "Bridges the linen tailoring and the evening slip — unlocks 5 looks").
Do not pack owned pieces she did not shortlist — she chose from her full wardrobe already.

` : ''}${suggestedItems.length ? `HER MOODBOARD PICKS (${suggestedItems.length} pieces she does NOT own — she is packing this trip from a moodboard she built):
${suggestedItems.map(s => `- ${s.name}${s.category ? ' [' + s.category + ']' : ''}${s.brand ? ', ' + s.brand : ''}${(s.retailer_hint || s.price_point) ? ' (' + [s.retailer_hint, s.price_point].filter(Boolean).join(' · ') + ')' : ''}`).join('\n')}
Include EACH of these as a new capsule piece (wardrobe_index -1) with its brand and a real "retailer_hint" + "price_point" (use the ones given where present) — they are her Worth Adding list and do NOT count against the new-piece cap. Style them into the lookbook like any other capsule piece. Only drop one if it genuinely cannot serve this trip.

` : ''}${closetBlock}${correctiveNote ? '\n\n' + correctiveNote : ''}`;
  }

  const userText = `${wxLine ? wxLine + '\n\n' : ''}THE TRIP BRIEF: ${dest}${dateLine ? ', ' + dateLine : ''}${monthName ? ' (' + monthName + ')' : ''}, ${tripDays} day${tripDays > 1 ? 's' : ''}. ${String(brief || '').trim() || 'No further notes — read the destination and season for the vibe.'}${vibeLine ? `\nTHE VIBE, IN HER WORDS: ${vibeLine}` : ''}

${shortIdxs.length ? `Pack every key piece, map the wears each one earns, add only what's genuinely missing — and build` : 'Build the capsule and'} ${looksTarget ? `${planList.length ? 'exactly ' + looksTarget : '~' + looksTarget} new look${looksTarget === 1 ? '' : 's'}${planList.length ? ' around her plans' : ''}${coveredList.length ? ` (${coveredList.length} plan${coveredList.length === 1 ? ' is' : 's are'} already covered by her own looks)` : ''}` : 'no new looks — her own packed looks cover every plan'}.`;

  async function withRetry(fn, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); } catch (err) {
        if (i === attempts - 1) throw err;
        await new Promise(r => setTimeout(r, 800 * Math.pow(2, i)));
      }
    }
  }

  function normalise(parsed) {
    const capsule = (Array.isArray(parsed.capsule) ? parsed.capsule : [])
      .filter(it => it && it.name)
      .slice(0, capMax)
      .map(it => {
        if (!TRAVEL_TIERS.includes(it.tier)) it.tier = TRAVEL_TIERS[0];
        const wi = Number.isInteger(it.wardrobe_index) && it.wardrobe_index >= 0 ? closetItems[it.wardrobe_index] : null;
        it.wardrobe_match = wi
          ? { id: wi.id, label: wi.label, image_url: wi.image_url || null, color: wi.color || '' }
          : null;
        return it;
      });
    const looks = (Array.isArray(parsed.looks) ? parsed.looks : [])
      .filter(l => l && Array.isArray(l.formula))
      .slice(0, 14)
      .map(l => {
        l.occasion = String(l.occasion || '').slice(0, 60);
        l.how = String(l.how || '').slice(0, 240);
        l.look_tags = normLookTags(l.look_tags);
        l.formula = l.formula
          .filter(f => f && TRAVEL_ROLES.includes(f.role) && Number.isInteger(f.item_index) && f.item_index >= 0 && f.item_index < capsule.length)
          .slice(0, 6);
        return l;
      })
      .filter(l => l.formula.length);
    // "Leave Behind" is deprecated — anything the model still tries to cut
    // is ignored; unaccounted() forces a corrective pass so every
    // key piece lands in the capsule instead.
    return { capsule, looks: looksTarget === 0 ? [] : looks, leftBehind: [] };
  }

  async function generate(correctiveNote) {
    const r = await withRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      config: {
        systemInstruction: travelSystem(correctiveNote),
        responseMimeType: 'application/json',
        responseSchema: TRAVEL_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 9000,
      },
    }));
    return deEscDeep(JSON.parse(r.text));
  }

  // Shortlisted pieces missing from the capsule — every shortlist piece
  // must be kept (Leave Behind is deprecated), never dropped.
  function unaccounted(capsule, leftBehind) {
    const seen = new Set([
      ...capsule.filter(it => it.wardrobe_match).map(it => String(it.wardrobe_match.id)),
      ...leftBehind.map(l => String(l.id)),
    ]);
    return shortIdxs.filter(si => !seen.has(String(closetItems[si].id)));
  }

  try {
    const t0 = Date.now();
    let parsed = await generate();
    let { capsule, looks, leftBehind } = normalise(parsed);

    // PRD §2 validation parser: one corrective pass when the 1:3 matrix
    // is materially violated (more than two under-used items) or a
    // key piece went unaccounted for (neither kept nor cut). Pieces from
    // her own packed looks earn their wears in looks the server never
    // sees, so they are exempt from the under-use count.
    const packedPieceNames = new Set(packedLooks.flatMap(l => l.pieces.map(p => p.toLowerCase())));
    const underused = (cap, lks) => travelUnderusedItems(cap, lks)
      .filter(i => !packedPieceNames.has(String((cap[i] || {}).name || '').toLowerCase()));
    const under = underused(capsule, looks);
    const missing = unaccounted(capsule, leftBehind);
    if (!capsule.length || (looksTarget > 0 && !looks.length) || under.length > 2 || missing.length) {
      const note = capsule.length && (looks.length || looksTarget === 0)
        ? `VALIDATION FAILURE ON YOUR LAST ATTEMPT — ${[
            under.length ? `these packed items were worn in fewer than 3 looks: ${under.map(i => capsule[i].name).join(', ')}` : '',
            missing.length ? `these key pieces were missing from the capsule: ${missing.map(i => closetItems[i].label).join(', ')}` : '',
          ].filter(Boolean).join('; ')}. Rework the edit so EVERY key piece is kept in the capsule, and EVERY capsule item earns at least three wears.`
        : '';
      logAI({ feature: 'travel', stage: 'validate', retry: true, underused: under.length, unaccounted: missing.length, empty: !capsule.length || (looksTarget > 0 && !looks.length) });
      try {
        const second = await generate(note);
        const norm2 = normalise(second);
        const under2 = underused(norm2.capsule, norm2.looks);
        const missing2 = unaccounted(norm2.capsule, norm2.leftBehind);
        if (norm2.capsule.length && (norm2.looks.length || looksTarget === 0) &&
            (!capsule.length || (looksTarget > 0 && !looks.length) || (missing2.length + under2.length) < (missing.length + under.length))) {
          parsed = second; capsule = norm2.capsule; looks = norm2.looks; leftBehind = norm2.leftBehind;
        }
      } catch { /* keep first attempt */ }
    }
    if (!capsule.length || (looksTarget > 0 && !looks.length)) throw new Error('empty travel edit');

    // Image frames: 0 = the hero editorial shot; then a still-life per
    // capsule item that has no wardrobe photo (owned photos are truthful
    // and free), capped so staggered generation stays under the client's
    // 5-minute polling ceiling.
    let frames = 1;
    capsule.forEach(it => {
      if (!(it.wardrobe_match && it.wardrobe_match.image_url) && frames < 8) it.image_index = frames++;
    });

    const owned = capsule.filter(it => it.wardrobe_match).length;
    logAI({ feature: 'travel', stage: 'text', model: 'gemini-2.5-flash', ms: Date.now() - t0, items: capsule.length, looks: looks.length, plans: planList.length, covered: coveredList.length, owned, leftBehind: leftBehind.length, shortlisted: shortIdxs.length, underused: underused(capsule, looks).length, fallback: parsed.fallback === true });
    // Composition (addendum to Tranche 2 Build 2) — the capsule is one
    // pack shared across the whole trip (not per-day like Weekly), so one
    // owned-vs-total figure for the trip is the meaningful unit here.
    (function () {
      const gctx = genCtx.getStore() || {};
      glog({
        user_id: gctx.userId || null,
        endpoint: '/api/travel',
        model: 'gemini-2.5-flash',
        status: 'ok',
        prompt: null,
        response: null,
        detail: { stage: 'composition', owned_count: owned, item_count: capsule.length, ...(gctx.genId ? { gen_id: gctx.genId } : {}) },
      });
    })();

    const jobId = randomBytes(6).toString('hex');
    imageJobs.set(jobId, { images: Array.from({ length: frames }, () => null), done: false, created: Date.now() });
    res.json({
      fallback: parsed.fallback === true,
      trip_label: parsed.trip_label || dest.toUpperCase(),
      headline: parsed.headline || '',
      location_vibe: parsed.location_vibe || '',
      stylist_summary: parsed.stylist_summary || '',
      suitcase_note: parsed.suitcase_note || '',
      palette: Array.isArray(parsed.palette) ? parsed.palette.slice(0, 3) : [],
      capsule,
      left_behind: leftBehind,
      looks,
      tripDays,
      plans: planList.concat(coveredList),
      destination: dest,
      dateFrom: validDates ? String(dateFrom) : '',
      dateTo: validDates ? String(dateTo) : '',
      dateLine,
      weather,
      jobId,
      imageCount: frames,
    });

    const t1 = Date.now();
    const capsuleNames = capsule.map(it => it.name).join(', ');
    (async () => {
      const stills = capsule.filter(it => Number.isInteger(it.image_index));
      for (let f = 0; f < frames; f++) {
        if (f > 0) await new Promise(r => setTimeout(r, 3000));
        const item = f === 0 ? null : stills[f - 1];
        const imgPrompt = f === 0
          ? `PORTRAIT ORIENTATION ONLY. Single editorial travel-fashion photograph — one ${wearerNoun(g)}, alone, one scene, no collage, no split panels, no text overlays. ${FULL_BODY_FRAME} ${styleIconsImageLine(styleIcons)}${parsed.location_vibe ? parsed.location_vibe + ' aesthetic. ' : ''}Setting: ${dest}${monthName ? ' in ' + monthName : ''}. ${wearerWears(g)} a complete look drawn from this capsule: ${capsuleNames}. Soft natural light, luxury resort campaign aesthetic.`
          : `Editorial still-life photograph of a single ${item.name}${item.brand ? ' by ' + item.brand : ''} — ${item.description || ''}. The piece styled alone on a neutral cream-linen surface, soft daylight, quiet luxury catalogue aesthetic. No model, no text, no collage, one item only.`;
        try {
          const r = await Promise.race([
            ai.models.generateContent({
              model: 'gemini-3.1-flash-image',
              contents: [{ role: 'user', parts: [{ text: imgPrompt }] }],
              config: { responseModalities: ['TEXT', 'IMAGE'] },
            }),
            new Promise(resolve => setTimeout(() => resolve(null), 50000)),
          ]);
          const part = r?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (!part?.inlineData) {
            logAI({ feature: 'travel', stage: 'image', index: f, success: false, reason: r ? 'no_inline_data' : 'timeout_50s' });
            continue;
          }
          const url = await cloudinaryUpload(part.inlineData.data, part.inlineData.mimeType);
          if (!url) {
            logAI({ feature: 'travel', stage: 'image', index: f, success: false, reason: 'cloudinary_failed' });
            continue;
          }
          logAI({ feature: 'travel', stage: 'image', index: f, success: true, ms: Date.now() - t1 });
          const job = imageJobs.get(jobId);
          if (job) job.images[f] = url;
        } catch (err) {
          logAI({ feature: 'travel', stage: 'image', index: f, success: false, reason: err.message });
        }
      }
      const job = imageJobs.get(jobId);
      if (job) job.done = true;
      logAI({ feature: 'travel', stage: 'images_complete', jobId, totalMs: Date.now() - t0 });
    })();
  } catch (err) {
    if (res.headersSent) return;
    logAI({ feature: 'travel', stage: 'text', success: false, reason: err.message });
    console.error('[travel] Gemini error:', err.message);
    res.status(500).json({ error: err.message || 'Travel edit failed' });
  }
});

/* ── travel edit: style more looks (looks-first UX 2026-07-30). Re-mixes
   an existing trip's capsule into fresh looks for occasions she names —
   the door in for "+ Style another look", the intake's day-scoped travel
   prompts (styled then pinned client-side) and trips saved before looks
   existed. Re-mix first: at most ONE new gap piece per call, and only
   when an occasion genuinely cannot be dressed from the capsule (e.g. a
   formal wedding with nothing formal packed). ── */
const TRAVEL_MORE_SCHEMA = {
  type: 'object',
  properties: {
    looks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          occasion: { type: 'string' },
          title: { type: 'string' },
          how: { type: 'string' },
          look_tags: LOOK_TAGS_SCHEMA,
          formula: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: TRAVEL_ROLES },
                item_index: { type: 'integer' },
                note: { type: 'string' },
              },
              required: ['role', 'item_index', 'note'],
            },
          },
        },
        required: ['occasion', 'title', 'how', 'look_tags', 'formula'],
      },
    },
    new_item_needed: { type: 'boolean' },
    new_item: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        tier: { type: 'string', enum: TRAVEL_TIERS },
        category: { type: 'string', enum: ['Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Bags', 'Accessories', 'Swim', 'Other'] },
        brand: { type: 'string' },
        description: { type: 'string' },
        bridge: { type: 'string' },
        retailer_hint: { type: 'string' },
        price_point: { type: 'string' },
      },
      required: ['name', 'tier', 'category', 'brand', 'description', 'retailer_hint', 'price_point'],
    },
  },
  required: ['looks', 'new_item_needed'],
};

app.post('/api/travel/looks', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const { destination, brief, vibe, occasions, weather, name, styleDna, styleIcons, capsule, gender } = req.body;
  const g = normGender(gender);
  const capIn = (Array.isArray(capsule) ? capsule : []).filter(c => c && c.name).slice(0, 24);
  const occList = (Array.isArray(occasions) ? occasions : [])
    .filter(o => typeof o === 'string' && o.trim())
    .map(o => o.trim().slice(0, 60))
    .slice(0, 10);
  if (!capIn.length || !occList.length) {
    return res.status(400).json({ error: 'Missing plans or capsule.' });
  }
  const dest = String(destination || '').trim().slice(0, 120) || 'the trip';
  const dnaBlock = styleDnaPromptBlock(styleDna, capIn.filter(c => c.owned).length, styleIcons);
  const vibeLine = String(vibe || '').trim().slice(0, 240);

  const capList = capIn.map((c, i) =>
    `${i}: ${c.name}${c.category ? ' [' + c.category + ']' : ''}${c.brand ? ', ' + c.brand : ''}${c.owned ? ' (hers)' : ''}`
  ).join('\n');
  const wxLine = weather && weather.tempRange
    ? `MICRO-CLIMATE: ${weather.city || dest} — ${weather.tempRange}, mostly ${weather.condition || 'mixed conditions'}.`
    : '';

  const systemInstruction = `You are Robes' head stylist — elite, editorial, precise. ${name ? `The user's name is ${name}. ` : ''}${genderDirective(g)} The user packed a capsule for ${dest}${brief ? ` (trip brief: "${String(brief).slice(0, 300)}")` : ''}${vibeLine ? ` — the vibe, in her words: "${vibeLine}"` : ''} and wants fresh looks styled from it. Never output a generic outfit — ban flat phrasing; every look is rendered with high descriptive specificity.

THE PACKED CAPSULE (referenced by "item_index"):
${capList}

RULES:
1. Style ONE look per occasion she names, in order — flat and day-agnostic (she pins looks to days herself; never mention a specific day): ${occList.map(o => `"${o}"`).join(', ')}. Each look's "occasion" is her label verbatim; "title" is a NAME for the look — 2–4 words in Title Case, never a sentence, never a trailing full stop ("Golden Hour", "Harbour Dinner" — NOT "Effortless exploration ensemble."); "how" is that look's PANEL NOTE. ${PANEL_NOTE_RULE}
2. RE-MIX FIRST. Build every formula ONLY from the capsule via "item_index" and the 4-step formula: "The Anchor" ×1, "The Canvas" ×1–2, "The Texture" ×1, "The Exclamation Point" ×1–2 (3 entries minimum for swim/undone moments). Each entry's "note" is that piece's ROW NOTE. ${ROW_NOTE_RULE} ${LOOK_TAGS_RULE.replace(/^- /, 'Each look\'s ')}
3. Set "new_item_needed": true ONLY if an occasion genuinely cannot be dressed from the capsule (e.g. a formal wedding with nothing remotely formal packed). Then give "new_item" — one real gap piece with retailer_hint, a realistic EUR price_point and a "bridge" clause (what it connects + looks it unlocks) — and reference it in the formulas as item_index ${capIn.length}. Otherwise "new_item_needed": false.

${BANNED_CONSTRUCTIONS_RULE}${dnaBlock ? '\n\n' + dnaBlock : ''}
${wxLine}`;

  try {
    const t0 = Date.now();
    const r = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: `Style ${occList.length} look${occList.length > 1 ? 's' : ''} from the packed capsule: ${occList.join(', ')}.` }] }],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: TRAVEL_MORE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 4000,
      },
    });
    const parsed = deEscDeep(JSON.parse(r.text));

    let newItem = parsed.new_item_needed === true && parsed.new_item && parsed.new_item.name
      ? { ...parsed.new_item, tier: TRAVEL_TIERS.includes(parsed.new_item.tier) ? parsed.new_item.tier : TRAVEL_TIERS[1], wardrobe_index: -1 }
      : null;
    const maxIdx = capIn.length - 1 + (newItem ? 1 : 0);
    const looks = (Array.isArray(parsed.looks) ? parsed.looks : [])
      .filter(l => l && Array.isArray(l.formula))
      .slice(0, occList.length)
      .map(l => {
        l.occasion = String(l.occasion || '').slice(0, 60);
        l.how = String(l.how || '').slice(0, 240);
        l.look_tags = normLookTags(l.look_tags);
        l.formula = l.formula
          .filter(f => f && TRAVEL_ROLES.includes(f.role) && Number.isInteger(f.item_index) && f.item_index >= 0 && f.item_index <= maxIdx)
          .slice(0, 6);
        return l;
      })
      .filter(l => l.formula.length);
    if (!looks.length) throw new Error('empty looks');
    // A suggested gap piece that no formula actually uses is dropped
    if (newItem && !looks.some(l => l.formula.some(f => f.item_index === capIn.length))) newItem = null;

    logAI({ feature: 'travel-looks', stage: 'text', model: 'gemini-2.5-flash', ms: Date.now() - t0, occasions: occList.length, looks: looks.length, newItem: !!newItem });
    res.json({ looks, new_item: newItem });
  } catch (err) {
    logAI({ feature: 'travel-looks', stage: 'text', success: false, reason: err.message });
    console.error('[travel-looks] Gemini error:', err.message);
    res.status(500).json({ error: err.message || 'Look styling failed' });
  }
});

/* ── look share ──────────────────────────────────────────────────── */
const BASE_URL = process.env.PUBLIC_URL || 'https://www.byrobes.com';

app.post('/api/look', (req, res) => {
  const { name, piece, photoUrl, ways, generatedImages, fallback, prompt, email } = req.body;
  if (!ways || !Array.isArray(ways) || ways.length === 0) {
    return res.status(400).json({ error: 'No look data' });
  }
  const id = randomBytes(5).toString('hex');
  lookStore.set(id, { name: name || '', piece: piece || '', photoUrl: photoUrl || null, ways, generatedImages: generatedImages || [], fallback: !!fallback, created: Date.now() });
  console.log(`Look saved: ${id} — ${piece || 'untitled'}`);
  res.json({ id });

  // async: upload generated images to Cloudinary, then persist to Airtable as structured JSON
  (async () => {
    const lookUrl = `${BASE_URL}/look/${id}`;
    const photoAttachments = [];
    if (photoUrl) photoAttachments.push({ url: photoUrl });

    const genUrls = await Promise.all(
      (generatedImages || []).map(src => {
        if (!src) return Promise.resolve(null);
        const m = src.match(/^data:([^;]+);base64,(.+)$/);
        return m ? cloudinaryUpload(m[2], m[1]) : Promise.resolve(null);
      })
    );
    genUrls.filter(Boolean).forEach(url => photoAttachments.push({ url }));

    // store full structured data so the look can be rebuilt after a server restart
    const lookData = JSON.stringify({ name: name || '', piece: piece || '', fallback: !!fallback, photoUrl: photoUrl || null, genImageUrls: genUrls, ways });

    await airtableCreate('Feedback', {
      'Email': email || '',
      'Prompt': prompt || '',
      'Piece Link': lookUrl,
      ...(photoAttachments.length ? { 'Photo': photoAttachments } : {}),
      'Looks Output': lookData,
      'Created At': new Date().toISOString().split('T')[0],
    });
    console.log(`Look persisted to Airtable: ${id}`);
  })().catch(err => console.warn('Look log error:', err.message));
});

app.get('/api/look/:id', async (req, res) => {
  const cached = lookStore.get(req.params.id);
  if (cached) return res.json(cached);

  // not in memory (server restarted) — try Airtable
  if (AT_TOKEN && AT_BASE) {
    try {
      const lookUrl = `${BASE_URL}/look/${req.params.id}`;
      const filter = encodeURIComponent(`{Piece Link} = "${lookUrl}"`);
      const atRes = await fetch(
        `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent('Feedback')}?filterByFormula=${filter}&maxRecords=1`,
        { headers: { 'Authorization': `Bearer ${AT_TOKEN}` } }
      );
      if (atRes.ok) {
        const data = await atRes.json();
        if (data.records && data.records.length > 0) {
          const fields = data.records[0].fields;
          let lookData = {};
          try { lookData = JSON.parse(fields['Looks Output'] || '{}'); } catch { /* old text format */ }
          if (lookData.ways && Array.isArray(lookData.ways)) {
            const look = {
              name: lookData.name || '',
              piece: lookData.piece || '',
              photoUrl: lookData.photoUrl || null,
              ways: lookData.ways,
              generatedImages: lookData.genImageUrls || [],
              fallback: lookData.fallback || false,
              created: Date.now(),
            };
            lookStore.set(req.params.id, look); // re-cache
            console.log(`Look restored from Airtable: ${req.params.id}`);
            return res.json(look);
          }
        }
      }
    } catch (err) { console.warn('Airtable look lookup error:', err.message); }
  }

  res.status(404).json({ error: 'Look not found or expired' });
});

app.get('/look/:id', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'look.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

// Internal admin record panel — the page itself gates on session +
// profiles.is_admin (non-admins bounce to the marketing lander).
app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

app.get('/wardrobe', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

// Wishlist nests under the wardrobe panel — same shell, client opens the view
// Looks live in the Lookbook (IA 2026-08-08) — /looks survives as a deep link
// onto the Lookbook's All looks shelf
app.get('/looks', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

// The Diary lives inside the Lookbook (IA refinement 2026-08-10 —
// Calendar renamed to Diary); /calendar survives as a legacy alias
app.get('/diary', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

app.get('/calendar', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

// Inspiration — undated, aspirational content (key pieces styled)
app.get('/inspiration', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

app.get('/wishlist', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

// A wardrobe (or wishlist) piece as its own page — the client opens the
// record once the wardrobe has loaded (Robes_Piece_IA, 2026-09-07)
app.get('/piece/:id', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

app.get('/lookbook', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

app.get('/moodboards', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

app.get('/moodboard/:slug', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

/* ── Public share pages — moodboards + lookbook (/board/:shareId) ──
   Reads lookbook_items through the anon key: RLS only exposes rows the
   owner explicitly flipped to is_public = true. The page is a single
   template with server-injected OG/Twitter meta (crawlers don't run JS)
   and the sanitized payload embedded inline — one Supabase round trip,
   no app shell. */
const SHARE_SUPA_URL = process.env.SUPABASE_URL || 'https://ayowpaknssulsqqvwpqx.supabase.co';
const SHARE_SUPA_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_D_iIPtp_R6kjN_711jfyTg_sFmRdpwJ';

function htmlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const isHttpUrl = (u) => typeof u === 'string' && /^https:\/\//.test(u);

// Whitelist-only public payload: no user ids, emails or account data ever
// leave this function — just the content that is explicitly in the board.
function publicSharePayload(row) {
  const d = row.data && typeof row.data === 'object' ? row.data : {};
  const type = row.type || 'key-piece';
  const images = [];
  const addImg = (u) => { if (isHttpUrl(u) && !images.includes(u) && images.length < 10) images.push(u); };
  const pieces = [];
  const addPiece = (name, brand, price) => {
    if (typeof name === 'string' && name.trim() && pieces.length < 24) {
      pieces.push({ name: name.trim(), brand: typeof brand === 'string' ? brand : '', price: typeof price === 'string' ? price : '' });
    }
  };
  let tags = [];
  let editorial = '';

  addImg(row.img);
  if (type === 'moodboard') {
    addImg(d.hero_image);
    (Array.isArray(d.grid_images) ? d.grid_images : []).forEach(g => addImg(g && g.url));
    (Array.isArray(d.the_look) ? d.the_look : []).forEach(i => i && addPiece(i.name, i.brand_name || i.retailer_hint, i.price_point));
    if (Array.isArray(d.aesthetic_tags)) tags = d.aesthetic_tags.filter(t => typeof t === 'string').slice(0, 6);
    if (typeof d.editorial_direction === 'string') editorial = d.editorial_direction;
  } else if (type === 'daily-look') {
    const dl = d.dlData || {};
    (Array.isArray(dl.steps) ? dl.steps : []).forEach(s => (Array.isArray(s && s.items) ? s.items : []).forEach(i => {
      if (!i) return;
      addPiece(i.name, i.brand, i.price_point);
      addImg((i.wardrobe_match && i.wardrobe_match.image_url) || (Number.isInteger(i.image_index) ? (dl.generatedImages || [])[i.image_index] : null) || i.image_url || i.img);
    }));
    if (typeof dl.stylist_summary === 'string') editorial = dl.stylist_summary;
  } else if (type === 'travel-edit') {
    const tv = d.tvData || {};
    (Array.isArray(tv.capsule) ? tv.capsule : []).forEach(i => {
      if (!i) return;
      addPiece(i.name, i.brand, i.price_point);
      addImg((i.wardrobe_match && i.wardrobe_match.image_url) || (Number.isInteger(i.image_index) ? (tv.generatedImages || [])[i.image_index] : null) || i.image_url || i.img);
    });
    if (typeof tv.stylist_summary === 'string') editorial = tv.stylist_summary;
  } else {
    const kp = d.kpData || {};
    (Array.isArray(kp.generatedImages) ? kp.generatedImages : []).forEach(addImg);
    addImg(kp.photoUrl);
    (Array.isArray(kp.ways) ? kp.ways : []).forEach(w => w && addPiece(w.title, w.eyebrow, ''));
    if (kp.ways && kp.ways[0] && typeof kp.ways[0].outfit === 'string') editorial = kp.ways[0].outfit;
  }

  return {
    type,
    title: row.title || 'A look by Robes',
    subtitle: row.subtitle || '',
    images,
    pieces,
    tags,
    editorial: editorial.slice(0, 400),
  };
}

let _boardTpl = null;
app.get('/board/:shareId', rateLimit({ windowMs: 60_000, max: 40 }), async (req, res) => {
  const shareId = String(req.params.shareId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  if (!_boardTpl) {
    try { _boardTpl = readFileSync(join(__dirname, 'public', 'board.html'), 'utf8'); }
    catch (e) { return res.status(500).send('Share pages unavailable'); }
  }
  const send = (status, payload, og) => {
    const json = JSON.stringify(payload).replace(/</g, '\\u003c');
    res.status(status).type('html').send(_boardTpl.replace('<!--__OG__-->', og).replace('__BOARD_JSON__', json));
  };
  const notFound = () => send(404, { notFound: true },
    `<title>Robes — this look isn’t shared any more</title>\n<meta name="robots" content="noindex">\n<meta property="og:title" content="Robes — styled for you">`);

  if (!shareId) return notFound();
  try {
    const r = await fetch(
      `${SHARE_SUPA_URL}/rest/v1/lookbook_items?share_id=eq.${encodeURIComponent(shareId)}&is_public=eq.true&limit=1&select=type,title,subtitle,img,data,created_at`,
      { headers: { apikey: SHARE_SUPA_ANON, Authorization: `Bearer ${SHARE_SUPA_ANON}` } }
    );
    const rows = r.ok ? await r.json() : [];
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row) return notFound();
    const payload = publicSharePayload(row);
    const pageUrl = `${process.env.PUBLIC_URL || 'https://www.byrobes.com'}/board/${shareId}`;
    const ogImage = payload.images[0] || '';
    const desc = payload.editorial || payload.subtitle || 'One prompt. Dressed for anything.';
    const og = [
      `<title>${htmlEsc(payload.title)} — styled by Robes</title>`,
      `<meta name="description" content="${htmlEsc(desc)}">`,
      `<link rel="canonical" href="${htmlEsc(pageUrl)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="Robes">`,
      `<meta property="og:title" content="${htmlEsc(payload.title)} — styled by Robes">`,
      `<meta property="og:description" content="${htmlEsc(desc)}">`,
      ogImage ? `<meta property="og:image" content="${htmlEsc(ogImage)}">` : '',
      `<meta property="og:url" content="${htmlEsc(pageUrl)}">`,
      `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">`,
      `<meta name="twitter:title" content="${htmlEsc(payload.title)} — styled by Robes">`,
      `<meta name="twitter:description" content="${htmlEsc(desc)}">`,
      ogImage ? `<meta name="twitter:image" content="${htmlEsc(ogImage)}">` : '',
    ].filter(Boolean).join('\n');
    send(200, payload, og);
  } catch (e) {
    console.warn('[board] share fetch failed:', e.message);
    notFound();
  }
});

app.get('/stylenotes', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'stylenotes.html'));
});

app.get('/onboarding', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'onboarding.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'signup.html'));
});

app.get('/reset', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'reset.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'terms.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'privacy.html'));
});

const ANALYSE_SCHEMA = {
  type: 'object',
  properties: {
    no_item_detected: { type: 'boolean' },
    label:                { type: 'string' },
    category:             { type: 'string', enum: ['Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Bags', 'Accessories', 'Swimwear', 'Other'] },
    category_l2:          { type: 'string' },
    category_l3:          { type: 'string' },
    color:                { type: 'string' },
    primary_color_hex:    { type: 'string' },
    editorial_color_name: { type: 'string' },
    brand:                { type: 'string' },
    silhouette_fit:       { type: 'array', items: { type: 'string' } },
    // ADR-002 §5 — ordinal, inferred, never a chip. Formality is among the
    // most visually legible attributes there is, so this costs nothing and
    // adds no tapping; it goes to the styling model only. If beta shows she
    // wants to filter on it, promote it out of item_dna to a column then.
    formality:            { type: 'string', enum: ['casual', 'smart', 'formal', 'black_tie'] },
    ai_generated_notes:   { type: 'string' },
  },
  required: ['no_item_detected', 'label', 'category', 'category_l2', 'category_l3', 'color', 'primary_color_hex', 'editorial_color_name', 'brand', 'silhouette_fit', 'formality', 'ai_generated_notes'],
};

// The full taxonomy tree for the client's Category / Subcategory / Item type
// selects — served rather than duplicated client-side so wardrobe_taxonomy.js
// stays the single source of truth.
app.get('/api/wardrobe/taxonomy', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  // tagDefaults ships with the tree so the add form can PREVIEW what the
  // migration-18 trigger is about to file — same mapping, served rather than
  // duplicated in the client. The preview is display only: an untouched add
  // sends no season_source, and the trigger does the actual write.
  res.json({ groups: TAXONOMY_GROUPS, tagDefaults: tagDefaultRows(), wearSeeds: WEAR_SEEDS });
});

app.post('/api/wardrobe/analyse', async (req, res) => {
  const { data, mimeType } = req.body;
  if (!data || !mimeType) return res.status(400).json({ error: 'Missing data or mimeType' });
  const t0 = Date.now();
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data } },
          { text: `You are a fashion intelligence engine for a luxury wardrobe app. Analyze this photo.

IMPORTANT: If no clothing item, garment, or accessory is clearly visible (e.g. the photo shows a face, a room, a screenshot, or unidentifiable content), set "no_item_detected": true and return all other fields as empty strings or empty arrays.

If a clothing item IS present, set "no_item_detected": false and fill every field:
"label": concise item name (e.g. "Camel wool coat", "Grey straight-leg jeans")
"category": one of — Tops, Bottoms, Dresses, Outerwear, Shoes, Bags, Accessories, Swimwear, Other
"formality": how dressed up the piece is — casual (jeans, tees, trainers), smart (tailoring, a silk shirt, a loafer), formal (cocktail dress, a tuxedo blazer, an evening shoe), black_tie (a gown, a dinner suit). Judge the GARMENT, not how it happens to be styled in the photo.
"category_l2" and "category_l3": file the piece in the Robes taxonomy below. Each line reads Category › Subcategory: item types. Pick the ONE line whose subcategory fits best, copy the subcategory name EXACTLY into category_l2, then copy the best-fitting item type from that line EXACTLY into category_l3. If no item type on the line fits, set category_l3 to "". If no subcategory fits at all, set both to "".
TAXONOMY:
${taxonomyPromptBlock()}
"color": pick ONE from this list only —
  Foundations: White, Cream, Navy, Charcoal, Black, Espresso
  Dimension Builders: Camel, Taupe, Olive, Aubergine, Forest, Bordeaux, Blush
  Exclamation Points: Ochre, Magenta, Cobalt, Emerald, Vermillion, Acid
  Multi-pattern: Print
"primary_color_hex": hex code of the dominant color (e.g. "#D2B48C")
"editorial_color_name": evocative color name (e.g. "Warm Caramel", "Washed Slate")
"brand": brand if visible, else ""
"silhouette_fit": array of 2-4 short descriptors (e.g. ["Blazer", "Single-breasted", "Relaxed"])
"ai_generated_notes": one editorial sentence under 15 words` }
        ]
      }],
      config: { responseMimeType: 'application/json', responseSchema: ANALYSE_SCHEMA, maxOutputTokens: 760, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    });

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = deEscDeep(JSON.parse(text));
    logAI({ feature: 'wardrobe_analyse', ms: Date.now() - t0, no_item_detected: parsed.no_item_detected, success: true });

    if (parsed.no_item_detected) {
      return res.json({ noItemDetected: true, label: '', category: 'Other', category_l2: null, category_l3: null, color: '', brand: '', notes: '', item_dna: { display: {}, structural_dna: { silhouette_fit: [] }, formality: '', llm_styling_context: {}, ai_generated_notes: '' } });
    }

    // 3-level taxonomy: validate the emitted (l2, l3) pair against the tree.
    // A valid pair also DECIDES the legacy category (the deterministic fold in
    // wardrobe_taxonomy.js) so `category` and `category_l2` can never disagree
    // on a surface that filters both; an invalid pair degrades to the model's
    // own single-level category with null L2/L3 — the pre-migration shape.
    const tax = resolveTaxonomy(parsed.category_l2, parsed.category_l3);

    const item_dna = {
      display: {
        title: parsed.label || '',
        editorial_color_name: parsed.editorial_color_name || '',
        primary_color_hex: parsed.primary_color_hex || '',
        brand_raw: parsed.brand || '',
      },
      structural_dna: {
        silhouette_fit: Array.isArray(parsed.silhouette_fit) ? parsed.silhouette_fit : [],
      },
      // Top-level sibling, not inside structural_dna: formality is a property
      // of the garment's register, not its cut, and the styling prompts read
      // it on its own. '' when the model gave nothing usable.
      formality: ['casual', 'smart', 'formal', 'black_tie'].includes(parsed.formality) ? parsed.formality : '',
      llm_styling_context: {},
      ai_generated_notes: parsed.ai_generated_notes || '',
    };

    res.json({
      label: parsed.label || '',
      category: tax ? tax.category : (parsed.category || 'Other'),
      category_l2: tax ? tax.category_l2 : null,
      category_l3: tax ? tax.category_l3 : null,
      color: parsed.color || '',
      brand: parsed.brand || '',
      notes: parsed.ai_generated_notes || '',
      item_dna,
    });
  } catch (err) {
    logAI({ feature: 'wardrobe_analyse', ms: Date.now() - t0, success: false, reason: err.message });
    console.error('[analyse] Gemini error:', err.message);
    res.json({ analysisFailed: true, label: '', category: 'Other', category_l2: null, category_l3: null, color: '', brand: '', notes: '', item_dna: { display: {}, structural_dna: { silhouette_fit: [] }, formality: '', llm_styling_context: {}, ai_generated_notes: '' } });
  }
});

const SEASON_ENUM = ['Light Spring', 'Warm Spring', 'Clear Spring', 'Light Summer', 'True Summer', 'Soft Summer', 'Soft Autumn', 'True Autumn', 'Dark Autumn', 'Clear Winter', 'True Winter', 'Dark Winter'];
const BODY_ENUM = ['Hourglass', 'Pear', 'Rectangle', 'Inverted Triangle', 'Apple'];

// Observation fields come FIRST (propertyOrdering) so the model commits to
// evidence before classifying — the JSON doubles as its chain of reasoning.
const COLOUR_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    no_face_detected: { type: 'boolean' },
    lighting_assessment: { type: 'string' },
    hair_observation: { type: 'string' },
    skin_observation: { type: 'string' },
    eye_observation:  { type: 'string' },
    undertone_reasoning: { type: 'string' },
    season_reasoning: { type: 'string' },
    undertone: { type: 'string', enum: ['Warm', 'Cool', 'Neutral-Warm', 'Neutral-Cool'] },
    contrast:  { type: 'string', enum: ['Low', 'Medium', 'High', 'Extremely High'] },
    chroma:    { type: 'string', enum: ['Low', 'Medium', 'High'] },
    lightness: { type: 'string', enum: ['Low', 'Medium', 'High'] },
    season:    { type: 'string', enum: SEASON_ENUM },
    skin_tone_hex:  { type: 'string' },
    hair_color_hex: { type: 'string' },
    eye_color_hex:  { type: 'string' },
    low_confidence: { type: 'boolean' },
  },
  propertyOrdering: ['no_face_detected', 'lighting_assessment', 'hair_observation', 'skin_observation', 'eye_observation', 'undertone_reasoning', 'season_reasoning', 'undertone', 'contrast', 'chroma', 'lightness', 'season', 'skin_tone_hex', 'hair_color_hex', 'eye_color_hex', 'low_confidence'],
  required: ['no_face_detected', 'lighting_assessment', 'hair_observation', 'skin_observation', 'eye_observation', 'undertone_reasoning', 'season_reasoning', 'undertone', 'contrast', 'chroma', 'lightness', 'season', 'skin_tone_hex', 'hair_color_hex', 'eye_color_hex', 'low_confidence'],
};

const SIL_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    no_person_detected: { type: 'boolean' },
    pose_assessment: { type: 'string' },
    shoulder_observation: { type: 'string' },
    waist_observation: { type: 'string' },
    hip_observation: { type: 'string' },
    shape_reasoning: { type: 'string' },
    shoulder_waist: { type: 'number' },
    hip_waist:      { type: 'number' },
    shoulder_hip:   { type: 'number' },
    body_shape:     { type: 'string', enum: BODY_ENUM },
    loose_clothing: { type: 'boolean' },
  },
  propertyOrdering: ['no_person_detected', 'pose_assessment', 'shoulder_observation', 'waist_observation', 'hip_observation', 'shape_reasoning', 'shoulder_waist', 'hip_waist', 'shoulder_hip', 'body_shape', 'loose_clothing'],
  required: ['no_person_detected', 'pose_assessment', 'shoulder_observation', 'waist_observation', 'hip_observation', 'shape_reasoning', 'shoulder_waist', 'hip_waist', 'shoulder_hip', 'body_shape', 'loose_clothing'],
};

const COLOUR_EXTRACT_PROMPT = `You are a master personal colour analyst trained in 12-season analysis. Analyse the person in this portrait the way you would in a live draping consultation.

IMPORTANT: If no human face is clearly visible (a garment, a room, a screenshot), set "no_face_detected": true and return every other field as empty string / false / any enum value.

ANALYSIS PROTOCOL — work through it in this exact order, writing your observations into the corresponding fields BEFORE committing to any classification:

1. "lighting_assessment": judge the photo's colour cast against the sclera (whites of the eyes) and any visible teeth — they are naturally near-neutral. Note any warm/cool cast, filters, mixed light or shadows, and mentally subtract that cast from every judgement below.
2. "hair_observation": describe the NATURAL hair colour and — critically — its temperature. Golden, honey, strawberry, caramel or copper tones → warm evidence. Ash, mousy, cool-beige, blue-black or silvery tones → cool evidence. Hair temperature is one of the strongest undertone signals; visible roots are the most natural reference.
3. "skin_observation": describe the cast-corrected skin — golden/peachy/olive vs rosy/pink/bluish; how it flushes; freckles (warm evidence) vs an even porcelain quality. Ignore clothing, background and makeup entirely.
4. "eye_observation": describe iris colour AND pattern. Warm eyes: golden brown, amber, hazel with gold flecks, warm green. Cool eyes: clear blue, grey-blue, grey, cool dark brown.
5. "undertone_reasoning": weigh ALL the evidence above (never a single cue) and argue for the undertone the way an analyst would.
6. "season_reasoning": combine undertone with the three dimensions below and argue for ONE of the 12 seasons.

THE THREE DIMENSIONS:
"contrast": value gap between skin, hair and eyes. Very dark hair on fair skin → "High"/"Extremely High". Blended values (e.g. blonde hair, light-to-medium skin) → "Low". Otherwise "Medium".
"chroma": clarity of the colouring after cast correction. Vivid, jewel-like, saturated features → "High". Soft, dusty, muted, greyed features → "Low". Otherwise "Medium".
"lightness": overall depth. Fair skin + light hair → "High". Deep skin or very dark hair → "Low". Otherwise "Medium".

THE 12 SEASONS — pick the single best fit:
- Light Spring: warm, VERY light, luminous — pale clear golden blonde, porcelain-fair warm skin, fresh and bright with zero mutedness.
- Warm Spring: distinctly golden, mid-toned, clear — golden blonde/copper hair, warm glow.
- Clear Spring: warm-leaning, HIGH chroma, high contrast — bright, vivid features.
- Light Summer: cool, very light, delicate — ash blonde, cool fair skin, low contrast.
- True Summer: fully cool, mid-toned, soft — ash hair, rosy skin, grey/blue eyes, no warmth anywhere.
- Soft Summer: cool-neutral and MUTED — greyed, misty colouring, low chroma.
- Soft Autumn: warm-neutral and MUTED — dark blonde/soft brown hair whose gold is blended with beige or ash, low-medium contrast, dusty warmth. The most common season for warm-leaning blondes whose colouring is soft rather than vivid.
- True Autumn: fully warm, rich, earthy — red/auburn/golden brown hair, golden skin.
- Dark Autumn: warm and DEEP — dark brown hair with warmth, deep eyes, high contrast.
- Clear Winter: cool, HIGH chroma, very high contrast — dark hair, bright eyes, vivid.
- True Winter: fully cool, saturated, stark — blue-black/dark ash hair, high contrast.
- Dark Winter: cool and DEEP — near-black hair, deep cool eyes, extremely high contrast.

DISCIPLINE RULES:
- A blonde with ANY golden or honey quality to her hair is warm-family (a Spring or Autumn), not a Summer — never read sun-lightened or highlighted golden blonde as ash.
- WITHIN the warm family, chroma is the axis that separates Spring from Autumn: genuinely clear, luminous, fresh colouring → a Spring; ANY dustiness, ashiness or mutedness blended with the warmth → an Autumn. Mutedness outranks lightness: a muted warm blonde is Soft Autumn, never Light Spring, no matter how light her hair.
- Muted + warm → Soft Autumn, not a Summer. Muted + cool → Soft Summer.
- "lightness": "High" requires very light blonde hair AND porcelain-fair skin together; mid-depth dark blonde is "Medium".
- Transient facial redness, flush, sunburn or rosacea is NOT evidence of coolness, brightness or high chroma — look past it to the underlying tone and judge chroma from hair and eyes.
- High contrast is impossible for blended blonde colouring — reserve it for genuinely dark hair on light skin.
- The final "undertone", "contrast", "chroma", "lightness" and "season" fields MUST be consistent with each other and with your written reasoning.

Also sample:
"skin_tone_hex": average cast-corrected skin hex from an evenly lit cheek (e.g. "#E0D6C4").
"hair_color_hex": dominant hair hex (e.g. "#8A7458").
"eye_color_hex": dominant iris hex (e.g. "#5A5836").
"low_confidence": true if a strong colour cast, heavy filter, mixed lighting or shadow makes the analysis unreliable even after correction.`;

const SIL_EXTRACT_PROMPT = `You are a master stylist assessing body architecture from a full-length photograph, the way you would in a live fitting.

IMPORTANT: If no full-length human figure is clearly visible (head-and-shoulders only, a garment, a room), set "no_person_detected": true, return 1 for every ratio and any enum value for "body_shape".

ANALYSIS PROTOCOL — write your observations into the corresponding fields BEFORE committing to any numbers or classification:

1. "pose_assessment": describe the pose and its distortions. CRITICAL: in mirror selfies one arm is raised to hold the phone — a raised arm lifts and visually widens that shoulder and can make balanced shoulders read broad. Judge shoulder width from the BONE STRUCTURE of the resting shoulder line, never from a raised arm, a hand on a hip, or a twisted torso. Note camera angle (a low camera widens hips, a high camera widens shoulders) and correct for it.
2. "shoulder_observation": the corrected skeletal shoulder width and slope.
3. "waist_observation": whether the waist visibly nips in relative to ribcage and hips ("defined"), curves gently ("soft"), or runs straight ("undefined"). Fitted clothing (leggings, tucked or close-fitting tops) makes this readable; note if loose garments hide it.
4. "hip_observation": the widest hip/thigh line relative to the corrected shoulder line.
5. "shape_reasoning": weigh the corrected observations and argue for ONE archetype.

THE 5 ARCHETYPES:
- Hourglass: shoulders and hips visually balanced, waist clearly narrower and defined. A defined waist with balanced shoulders and hips is Hourglass even when the shoulders look athletic.
- Pear: hips clearly wider than shoulders, defined waist, fuller hips/thighs.
- Rectangle: shoulders, waist and hips on one line — minimal waist definition, lean and straight.
- Inverted Triangle: shoulders GENUINELY and skeletally broader than hips (swimmer's build), narrow lean hips, little waist emphasis. Do NOT choose this just because an arm is raised or the person is lean — it requires an unmistakably broader corrected shoulder line AND a waist that does not nip in.
- Apple: volume carried at the midsection, waist wider than or equal to hips, lean legs.

Then estimate the CORRECTED ratios from visible landmarks (outer shoulder margins at rest, narrowest natural waist plane, widest hip boundary):
"shoulder_waist": shoulder width ÷ waist width (e.g. 1.35)
"hip_waist": hip width ÷ waist width (e.g. 1.32)
"shoulder_hip": shoulder width ÷ hip width (e.g. 1.02)
"body_shape": the archetype your reasoning concluded — it MUST be consistent with your written observations and ratios.
"loose_clothing": true if oversized or loose garments hide the natural waistline, making the read unreliable.`;

app.post('/api/stylenotes/analyse', async (req, res) => {
  const { kind, data, mimeType } = req.body;
  if (!data || !mimeType || !['colour', 'silhouette'].includes(kind)) {
    return res.status(400).json({ error: 'Missing kind, data or mimeType' });
  }
  const colour = kind === 'colour';
  const t0 = Date.now();
  try {
    // Gemini writes stylist-grade observations, a direct archetype call AND the
    // measurable primitives; style_dna.js reconciles them (holistic call wins,
    // the primitive mapping is the deterministic fallback + cross-check) and
    // owns every palette/design rule the user sees (PRD: Style DNA).
    // Pro leads (this is a once-per-user judgement call worth the latency and
    // it cannot disable thinking, so its budget is bounded instead); flash is
    // the fallback, last attempt drops the schema and trusts JSON mode.
    // Onboarding sends fast:true — there, first-session momentum beats the
    // marginal judgement gain, so flash answers first and pro is the rescue.
    const ATTEMPTS = req.body.fast ? [
      { model: 'gemini-2.5-flash', schema: true },
      { model: 'gemini-2.5-pro', schema: true },
      { model: 'gemini-2.5-flash', schema: false },
    ] : [
      { model: 'gemini-2.5-pro', schema: true },
      { model: 'gemini-2.5-flash', schema: true },
      { model: 'gemini-2.5-flash', schema: false },
    ];
    let parsed, lastErr, used, finishReason;
    for (const a of ATTEMPTS) {
      const config = {
        responseMimeType: 'application/json',
        maxOutputTokens: a.model === 'gemini-2.5-pro' ? 4096 : 2048,
        temperature: 0,
        thinkingConfig: { thinkingBudget: a.model === 'gemini-2.5-pro' ? 1024 : 0 },
      };
      if (a.schema) config.responseSchema = colour ? COLOUR_EXTRACT_SCHEMA : SIL_EXTRACT_SCHEMA;
      try {
        // A hung model call must fall through to the next attempt, never hang
        // the request — the client is sitting on "Reading your colouring…".
        const attemptMs = a.model === 'gemini-2.5-pro' ? 45000 : 25000;
        const result = await Promise.race([
          ai.models.generateContent({
            model: a.model,
            contents: [{
              role: 'user',
              parts: [
                { inlineData: { mimeType, data } },
                { text: colour ? COLOUR_EXTRACT_PROMPT : SIL_EXTRACT_PROMPT },
              ],
            }],
            config,
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('analyse timeout (' + a.model + ')')), attemptMs)),
        ]);
        finishReason = result.candidates?.[0]?.finishReason;
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        try {
          parsed = JSON.parse(text);
        } catch (parseErr) {
          console.error('[stylenotes/analyse] JSON parse failed —', { kind, model: a.model, finishReason, textLength: text.length, tail: text.slice(-120) });
          throw new Error('truncated_response:' + finishReason);
        }
        used = a;
        break;
      } catch (e) {
        lastErr = e;
        console.error(`[stylenotes/analyse] ${a.model} (${a.schema ? 'with' : 'without'} schema) failed:`, e.message);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (!parsed) throw lastErr;
    const rejected = colour ? parsed.no_face_detected : parsed.no_person_detected;
    if (rejected) {
      logAI({ feature: 'stylenotes_analyse', kind, model: used.model, ms: Date.now() - t0, finishReason, rejected: true, success: true });
      return res.json(colour ? { no_face_detected: true } : { no_person_detected: true });
    }
    const { render, dna } = colour ? buildColorHarmony(parsed) : buildSilhouette(parsed);
    logAI({ feature: 'stylenotes_analyse', kind, model: used.model, ms: Date.now() - t0, finishReason, rejected: false, success: true, archetype: colour ? dna.archetype_name : dna.body_type });
    res.json({ ...render, style_dna: dna });
  } catch (err) {
    logAI({ feature: 'stylenotes_analyse', kind, ms: Date.now() - t0, success: false, reason: err.message });
    console.error('[stylenotes/analyse] Gemini error:', err.message);
    res.status(502).json({ error: 'analysis_failed', reason: String(err.message || '').slice(0, 200) });
  }
});

/* ── style notes try-on imagery ──────────────────────────────────── */
// Fills the Style Notes placeholder frames with real imagery of the user:
// colour → the proof pair (best vs avoid drape), silhouette → the four dress
// silhouettes. Same background-job + Cloudinary + polling infra as /api/style;
// only hosted URLs are written to the job so results can persist in profiles.
app.post('/api/stylenotes/tryon', rateLimit({ windowMs: 60_000, max: 6 }), async (req, res) => {
  const { kind, data, mimeType, photoUrl, analysis } = req.body;
  if (!['colour', 'silhouette'].includes(kind) || !analysis || typeof analysis !== 'object') {
    return res.status(400).json({ error: 'Missing kind or analysis' });
  }

  let photo = data && mimeType ? { data, mimeType } : null;
  if (!photo && typeof photoUrl === 'string' && /^https:\/\/res\.cloudinary\.com\//.test(photoUrl)) {
    try {
      const r = await fetch(photoUrl);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        photo = { data: buf.toString('base64'), mimeType: r.headers.get('content-type') || 'image/jpeg' };
      }
    } catch (err) {
      console.error('[stylenotes/tryon] photo fetch failed:', err.message);
    }
  }
  if (!photo) return res.status(400).json({ error: 'Missing photo' });

  const IDENTITY = 'Edit the provided photograph. Keep the SAME person — identical face, hair and skin; a faithful likeness. Photorealistic editorial photography, soft even daylight, clean warm-grey studio backdrop, no text overlays, no collage, one single image.';
  let prompts;
  if (kind === 'colour') {
    const best = (analysis.best_colours || [])[0];
    const avoid = (analysis.avoid_colours || [])[0];
    if (!best || !avoid) return res.status(400).json({ error: 'Missing colours' });
    prompts = [best, avoid].map(c =>
      `${IDENTITY} Chest-up portrait, facing the camera with a calm expression. Change only the clothing: an elegant simple crew-neck knit top in ${c.name} (${c.hex}). The top must fill the frame below the face so its colour reads clearly against the skin.`);
  } else {
    const dresses = (analysis.dress_silhouettes || []).slice(0, 4);
    if (!dresses.length) return res.status(400).json({ error: 'Missing dress silhouettes' });
    const tone = typeof analysis.dress_colour === 'string' && analysis.dress_colour ? analysis.dress_colour : 'a deep elegant neutral tone';
    prompts = dresses.map(d =>
      `${IDENTITY} Full-length editorial photograph, head to toe, standing naturally. Change only the clothing: a ${String(d.name || '').toLowerCase()} — ${String(d.note || '').toLowerCase()} — in ${tone}, styled with simple elegant shoes. The dress silhouette must read clearly.`);
  }

  const jobId = randomBytes(6).toString('hex');
  imageJobs.set(jobId, { images: prompts.map(() => null), done: false, created: Date.now() });
  res.json({ jobId, count: prompts.length });

  const t0 = Date.now();
  (async () => {
    for (let i = 0; i < prompts.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 3000)); // stagger under Gemini's rate limit
      try {
        const r = await Promise.race([
          ai.models.generateContent({
            model: 'gemini-3.1-flash-image',
            contents: [{ role: 'user', parts: [
              { inlineData: { mimeType: photo.mimeType, data: photo.data } },
              { text: prompts[i] },
            ] }],
            config: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
          new Promise(resolve => setTimeout(() => resolve(null), 50000)),
        ]);
        const part = r?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!part?.inlineData) {
          logAI({ feature: 'stylenotes_tryon', kind, index: i, success: false, reason: r ? 'no_inline_data' : 'timeout_50s' });
          continue;
        }
        const url = await cloudinaryUpload(part.inlineData.data, part.inlineData.mimeType);
        if (!url) {
          logAI({ feature: 'stylenotes_tryon', kind, index: i, success: false, reason: 'cloudinary_failed' });
          continue;
        }
        logAI({ feature: 'stylenotes_tryon', kind, index: i, success: true, ms: Date.now() - t0 });
        const job = imageJobs.get(jobId);
        if (job) job.images[i] = url;
      } catch (err) {
        logAI({ feature: 'stylenotes_tryon', kind, index: i, success: false, reason: err.message });
      }
    }
    const job = imageJobs.get(jobId);
    if (job) job.done = true;
    logAI({ feature: 'stylenotes_tryon', kind, stage: 'complete', totalMs: Date.now() - t0 });
  })();
});

/* ── avatar render — looks photographed on her model ─────────────────
   Phase 2 of the avatar work (docs/avatar-render-proposal.md §3.4).
   The avatar catalog's attribute space mirrors the client mapper in
   stylenotes.html (MV_SKINS/MV_HAIRS/figure keys) — keep the two in sync.
   Cells generate LAZILY: the first render that needs a cell generates its
   reference image once, uploads to Cloudinary, and stores it in
   avatar_cells (service key; in-process cache when the table/key is
   missing). Renders re-feed that stored reference on every call — the
   reference image IS the identity, never a re-description in text. */

const AVATAR_SKIN_WORDS = [
  'deep espresso brown', 'rich mahogany brown', 'warm chestnut brown', 'golden tan',
  'warm honey beige', 'soft warm sand', 'light warm peach', 'fair cool porcelain',
];
const AVATAR_HAIR_WORDS = ['jet black', 'dark espresso brown', 'chestnut brown', 'golden caramel blonde', 'light ash blonde'];
// Internal figure keys only — this vocabulary is prompt-side and never
// reaches consumer copy (the "no body type language" rule is about the UI).
const AVATAR_FIG_WORDS = {
  hg: 'balanced figure with a clearly defined waist',
  pe: 'figure with hips gently fuller than her shoulders',
  re: 'straight athletic figure with a subtle waist',
  it: 'figure with shoulders gently broader than her hips',
  ap: 'soft rounded figure carrying fullness through the middle',
  nt: 'balanced natural figure',
};
const AVATAR_FIG_WORDS_M = {
  hg: 'balanced, athletic build with a defined waist',
  pe: 'build carrying gentle fullness through the hips',
  re: 'straight, lean build',
  it: 'broad-shouldered build tapering to the waist',
  ap: 'soft, rounded build carrying fullness through the middle',
  nt: 'balanced natural build',
};
const AVATAR_NUDGE_WORDS = { ll: 'soft, curved lines', lr: 'long, straight lines', fl: 'a fuller frame', fr: 'a narrower, slighter frame' };

// Cell id prefix: 'w' woman / 'm' man ('unspecified' rides the woman catalog,
// mirroring today's render-surface behaviour). Legacy ids are all 'w-…'.
function parseAvatarId(id) {
  const m = /^([wm])-s([0-7])-h([0-4])-(hg|pe|re|it|ap|nt)((?:-(?:ll|lr|fl|fr))*)$/.exec(String(id || ''));
  if (!m) return null;
  const nudges = (m[5] || '').split('-').filter(Boolean);
  return { gender: m[1] === 'm' ? 'man' : 'woman', skin: Number(m[2]), hair: Number(m[3]), fig: m[4], nudges };
}
function avatarDescriptor(id) {
  const c = parseAvatarId(id);
  if (!c) return null;
  const man = c.gender === 'man';
  const hairLine = man
    ? `short ${AVATAR_HAIR_WORDS[c.hair]} hair`
    : `long ${AVATAR_HAIR_WORDS[c.hair]} hair worn down`;
  let d = `${man ? 'He' : 'She'} has ${AVATAR_SKIN_WORDS[c.skin]} skin, ${hairLine}, and a ${(man ? AVATAR_FIG_WORDS_M : AVATAR_FIG_WORDS)[c.fig]}`;
  const extras = c.nudges.map(n => AVATAR_NUDGE_WORDS[n]).filter(Boolean);
  if (extras.length) d += ', with ' + extras.join(' and ');
  return d + '.';
}

const AVATAR_STUDIO = 'Soft even daylight, clean warm-grey studio backdrop, photorealistic editorial photography, no text overlays, no collage, one single image.';

async function fetchCloudinaryB64(url) {
  if (typeof url !== 'string' || !/^https:\/\/res\.cloudinary\.com\//.test(url)) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { data: buf.toString('base64'), mimeType: r.headers.get('content-type') || 'image/jpeg' };
  } catch (e) { return null; }
}

const avatarCellCache = new Map(); // storage key → image_url (process-lifetime)

// The art direction of the cell imagery is versioned in the STORAGE key
// only — avatar_id stays stable everywhere (profiles, render_key, the
// client mapper) while a style bump quietly invalidates every cached
// portrait. v2 = the SKIMS-register base layer (2026-09-01: skin-tone
// seamless set, barefoot, hair down) that the model page now shows.
const AVATAR_CELL_STYLE = 'v2';
const avatarCellKey = (id) => id + '@' + AVATAR_CELL_STYLE;

async function avatarCellRead(rawId) {
  const id = avatarCellKey(rawId);
  if (avatarCellCache.has(id)) return avatarCellCache.get(id);
  if (SUPA_SERVICE_KEY) {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/avatar_cells?id=eq.${encodeURIComponent(id)}&select=image_url`, {
        headers: { apikey: SUPA_SERVICE_KEY, Authorization: 'Bearer ' + SUPA_SERVICE_KEY },
      });
      if (r.ok) {
        const rows = await r.json();
        if (rows[0] && rows[0].image_url) { avatarCellCache.set(id, rows[0].image_url); return rows[0].image_url; }
      }
    } catch (e) { /* table may not exist yet — lazy generation covers it */ }
  }
  return null;
}

async function avatarCellWrite(rawId, url, descriptor) {
  const id = avatarCellKey(rawId);
  avatarCellCache.set(id, url);
  if (!SUPA_SERVICE_KEY) return;
  try {
    await fetch(`${SUPA_URL}/rest/v1/avatar_cells?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: SUPA_SERVICE_KEY, Authorization: 'Bearer ' + SUPA_SERVICE_KEY,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ id, image_url: url, descriptor }),
    });
  } catch (e) { /* in-process cache still holds it */ }
}

// Generate a cell's reference image (once per cell, ever). One retry after
// an 8s pause — the same discipline as every other image path here.
// Concurrent asks for the same cell share one generation (the model page
// and a look render can both want a fresh cell in the same breath).
const avatarCellInflight = new Map(); // raw id → promise
async function avatarCellEnsure(id) {
  const have = await avatarCellRead(id);
  if (have) return have;
  if (avatarCellInflight.has(id)) return avatarCellInflight.get(id);
  const p = avatarCellGenerate(id).finally(() => avatarCellInflight.delete(id));
  avatarCellInflight.set(id, p);
  return p;
}
async function avatarCellGenerate(id) {
  const desc = avatarDescriptor(id);
  if (!desc) return null;
  const man = parseAvatarId(id).gender === 'man';
  // The base layer is the SKIMS register: a seamless neutral set close to
  // the skin tone, barefoot — so every garment later rendered onto the
  // model reads against a near-nude ground, never against jeans.
  const baseLayer = man
    ? 'He wears a minimal fitted base layer in one soft neutral tone close to his skin — a plain fitted crew-neck T-shirt and plain fitted knee-length shorts — barefoot, no accessories, no jewellery, no logos, no patterns.'
    : 'She wears a minimal seamless base layer in one soft neutral tone close to her skin — a fitted scoop-neck stretch tank top and matching fitted mid-thigh shorts, like a seamless shapewear set — barefoot, no accessories, no jewellery, no logos, no patterns.';
  const prompt = `Full-length editorial fashion photograph of one ${man ? 'man' : 'woman'}, alone — a recurring model, and this is the reference portrait. ${desc} ${baseLayer} Standing relaxed, facing the camera directly, arms at ${man ? 'his' : 'her'} sides, calm expression${man ? '' : ', hair worn down, naturally framing her face'}. ${FULL_BODY_FRAME} ${AVATAR_STUDIO}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 8000));
    try {
      const r = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.1-flash-image',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          // 4:5 — the canvas frame every render and the cell are shown in
          config: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '4:5' } },
        }),
        new Promise(resolve => setTimeout(() => resolve(null), 50000)),
      ]);
      const part = r?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!part?.inlineData) { logAI({ feature: 'avatar_cell', id, attempt, success: false, reason: r ? 'no_inline_data' : 'timeout_50s' }); continue; }
      const url = await cloudinaryUpload(part.inlineData.data, part.inlineData.mimeType);
      if (!url) { logAI({ feature: 'avatar_cell', id, attempt, success: false, reason: 'cloudinary_failed' }); continue; }
      await avatarCellWrite(id, url, desc);
      logAI({ feature: 'avatar_cell', id, success: true });
      return url;
    } catch (err) {
      logAI({ feature: 'avatar_cell', id, attempt, success: false, reason: err.message });
    }
  }
  return null;
}

// Resolve the wearer's model for any generation surface: an explicit
// avatarId in the body wins, else the profile's avatar_id (service key;
// needs migration 20). Returns the reference image ready for an inlineData
// part, or null — callers degrade to today's generic model on null.
// `gender` (normalised) gates the catalog: a look styled for a man never
// renders on a 'w-…' cell and vice versa — a stale opposite-prefix id
// simply falls through to the generic model until the next keep.
async function avatarRefForUser(avatarId, userId, gender) {
  let aid = parseAvatarId(avatarId) ? avatarId : null;
  if (!aid && SUPA_SERVICE_KEY && /^[0-9a-f][0-9a-f-]{10,}$/i.test(String(userId || ''))) {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=avatar_id`, {
        headers: { apikey: SUPA_SERVICE_KEY, Authorization: 'Bearer ' + SUPA_SERVICE_KEY },
      });
      if (r.ok) {
        const rows = await r.json();
        if (rows[0] && parseAvatarId(rows[0].avatar_id)) aid = rows[0].avatar_id;
      }
    } catch (e) { /* generic model stands */ }
  }
  if (!aid) return null;
  const want = (gender === 'man' || gender === 'woman') ? gender : 'woman';
  if (parseAvatarId(aid).gender !== want) return null;
  const cellUrl = await avatarCellEnsure(aid);
  return cellUrl ? await fetchCloudinaryB64(cellUrl) : null;
}
// The identity lock for look frames: the same model, new scene every time.
// Gender-neutral on purpose — the reference image itself carries the identity.
const AVATAR_IDENTITY = 'The FIRST image is the model. Keep the SAME person: identical face, hair, skin tone and figure; a faithful likeness of the first image. Ignore the first image\'s plain base layer and studio backdrop entirely — dress the model in the look described and place them in a real setting that suits the occasion. ';

/* The model page shows the cell itself (2026-09-01 — no more abstract
   figure): POST {avatarId} → {url} when the cell already exists, else
   {jobId} while it generates lazily (poll the standard GET /api/images/:jobId).
   Cells are a shared catalog keyed by cell id, so anything generated while
   she adjusts pre-fills the catalog for everyone. */
app.post('/api/avatar/cell', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const { avatarId } = req.body;
  if (!parseAvatarId(avatarId)) return res.status(400).json({ error: 'bad avatarId' });
  const have = await avatarCellRead(avatarId);
  if (have) return res.json({ url: have });
  const jobId = randomBytes(6).toString('hex');
  imageJobs.set(jobId, { images: [null], done: false, created: Date.now() });
  res.json({ jobId });
  (async () => {
    try {
      const url = await avatarCellEnsure(avatarId);
      const job = imageJobs.get(jobId);
      if (job) { if (url) job.images[0] = url; job.done = true; }
    } catch (err) {
      logAI({ feature: 'avatar_cell', id: avatarId, success: false, reason: err.message });
      const job = imageJobs.get(jobId);
      if (job) job.done = true;
    }
  })();
});

// The look composer renders her on every rack change (debounced client-side,
// cached by render key), so the window is wider than the save-only days and a
// single piece is a legitimate ask — she wears it over her base layer.
app.post('/api/avatar/render', rateLimit({ windowMs: 60_000, max: 12 }), async (req, res) => {
  const { avatarId, pieces } = req.body;
  if (!parseAvatarId(avatarId)) return res.status(400).json({ error: 'bad avatarId' });
  if (!Array.isArray(pieces) || pieces.length < 1 || pieces.length > 12) {
    return res.status(400).json({ error: 'pieces must hold 1–12 entries' });
  }
  const clean = pieces.map(p => ({
    name: String(p && p.name || '').slice(0, 120),
    category: String(p && p.category || '').slice(0, 40),
    color: String(p && p.color || '').slice(0, 40),
    brand: String(p && p.brand || '').slice(0, 60),
    image_url: typeof (p && p.image_url) === 'string' ? p.image_url : null,
  })).filter(p => p.name);
  if (clean.length < 1) return res.status(400).json({ error: 'pieces must be named' });

  const jobId = randomBytes(6).toString('hex');
  imageJobs.set(jobId, { images: [null], done: false, created: Date.now() });
  res.json({ jobId, count: 1 });

  const t0 = Date.now();
  (async () => {
    const finish = () => { const job = imageJobs.get(jobId); if (job) job.done = true; };
    try {
      const cellUrl = await avatarCellEnsure(avatarId);
      if (!cellUrl) { logAI({ feature: 'avatar_render', avatarId, success: false, reason: 'no_cell' }); return finish(); }
      const avatar = await fetchCloudinaryB64(cellUrl);
      if (!avatar) { logAI({ feature: 'avatar_render', avatarId, success: false, reason: 'cell_fetch_failed' }); return finish(); }

      // Garment references: up to 9 photographed pieces ride as images
      // (1 avatar + 9 garments stays well inside the 14-reference budget);
      // the rest are described in text.
      const parts = [{ inlineData: { mimeType: avatar.mimeType, data: avatar.data } }];
      const lines = [];
      let imgN = 1;
      for (const p of clean) {
        const detail = [p.color, p.category].filter(Boolean).join(' ') + (p.brand ? ' by ' + p.brand : '');
        let ref = null;
        if (imgN < 10 && p.image_url) ref = await fetchCloudinaryB64(p.image_url);
        if (ref) {
          imgN += 1;
          parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
          lines.push(`- IMAGE ${imgN}: the ${p.name}${detail ? ' (' + detail + ')' : ''} — reproduce this exact garment faithfully: its true colour, cut, fabric and details.`);
        } else {
          lines.push(`- the ${p.name}${detail ? ' (' + detail + ')' : ''}.`);
        }
      }
      const cellMan = parseAvatarId(avatarId).gender === 'man';
      const prompt =
        `Create one photorealistic editorial photograph. IMAGE 1 is the model. Keep the SAME ${cellMan ? 'man' : 'woman'}: identical face, hair, skin tone and figure; a faithful likeness of IMAGE 1. ` +
        `Dress ${cellMan ? 'him' : 'her'} in ${clean.length > 1 ? 'this complete outfit — every listed piece worn together, nothing substituted, nothing extra beyond simple essentials' : 'this piece, worn over the plain fitted base layer from IMAGE 1 — nothing substituted, nothing extra'}:\n` +
        lines.join('\n') + '\n' +
        `Standing naturally, facing the camera. ${FULL_BODY_FRAME} ${AVATAR_STUDIO} Generate the single photograph now.`;
      parts.push({ text: prompt });

      // Three attempts with widening backoff — a demand spike returns text
      // ("has_image": false) or a 503 rather than a frame, and one 8s retry
      // proved too polite for it in live testing (2026-08-25).
      let url = null;
      for (let attempt = 0; attempt < 3 && !url; attempt++) {
        if (attempt === 1) await new Promise(r => setTimeout(r, 8000));
        if (attempt === 2) await new Promise(r => setTimeout(r, 20000));
        let r = null;
        try {
          r = await Promise.race([
            ai.models.generateContent({
              model: 'gemini-3.1-flash-image',
              contents: [{ role: 'user', parts }],
              config: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '4:5' } },
            }),
            new Promise(resolve => setTimeout(() => resolve(null), 60000)),
          ]);
        } catch (err) {
          logAI({ feature: 'avatar_render', avatarId, attempt, success: false, reason: err.message });
          continue;
        }
        const part = r?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!part?.inlineData) {
          // When the model answers with prose instead of a frame, the prose
          // is the diagnosis — surface it in the Railway logs.
          const said = r?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
          logAI({ feature: 'avatar_render', avatarId, attempt, success: false, reason: r ? 'no_inline_data' : 'timeout_60s', said: said ? String(said).slice(0, 200) : undefined });
          continue;
        }
        url = await cloudinaryUpload(part.inlineData.data, part.inlineData.mimeType);
        if (!url) logAI({ feature: 'avatar_render', avatarId, attempt, success: false, reason: 'cloudinary_failed' });
      }
      if (url) {
        const job = imageJobs.get(jobId);
        if (job) job.images[0] = url;
        logAI({ feature: 'avatar_render', avatarId, pieces: clean.length, refs: imgN - 1, success: true, ms: Date.now() - t0 });
      }
    } catch (err) {
      logAI({ feature: 'avatar_render', avatarId, success: false, reason: err.message });
    }
    finish();
  })();
});

/* ── moodboard ───────────────────────────────────────────────────── */
app.post('/api/moodboard', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const { prompt, wardrobeItems = [], styleDna = null, styleIcons = [], gender } = req.body;
  const g = normGender(gender);
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });

  const wardrobeCtx = wardrobeItems.length
    ? `The user's wardrobe contains these pieces: ${wardrobeItems.map(i => `${i.label} (${i.category}${i.color ? ', ' + i.color : ''})`).join('; ')}.`
    : 'The user has not yet digitised their wardrobe.';

  const systemPrompt = `You are Robes, an elite personal stylist AI. ${genderDirective(g)} The user has given you a specific styling brief — your entire response must be tailored to THAT brief. Return ONLY valid JSON with no markdown fences.`;

  const userPrompt = `USER'S STYLING BRIEF: "${prompt}"

Everything you generate must be specific to the brief above — destination, climate, occasion, and aesthetic must all reflect it directly.

${wardrobeCtx}
${styleDnaPromptBlock(styleDna, wardrobeItems.length, styleIcons)}

Return this JSON shape (all fields must reflect the user's brief, not a generic example):
{
  "title": "Short poetic moodboard title (max 6 words, specific to the brief)",
  "location_context": "Location from the brief · Month | estimated temp range | one-line styling directive",
  "aesthetic_tags": ["TAG1","TAG2","TAG3","TAG4"],
  "editorial_direction": "2 sentences of hyper-specific editorial direction for THIS brief — reference relevant fashion house DNA or style muse.",
  "the_look": [
    {
      "name": "Item name",
      "category": "One of: Tops, Bottoms, Dresses, Outerwear, Shoes, Bags, Accessories",
      "description": "Hyper-specific: cut, fabric, colour — suited to this brief",
      "styling_note": "One sentence on how to wear it in this specific context",
      "retailer_hint": "Best contemporary/luxury retailer for this piece (e.g. 'Net-a-Porter', 'ASOS', 'Zara', 'Matches', 'MatchesFashion', 'Mytheresa')",
      "price_point": "Realistic price in EUR with € symbol (e.g. '€89', '€245', '€1,200')"
    }
  ],
  "image_prompts": {
    "hero_looks": [
      "Editorial campaign shot 1 — full outfit formula on model in a setting specific to this brief, with garments, environment, and lighting described in precise detail. Portrait orientation. No text overlays.",
      "Editorial campaign shot 2 — second angle or styling variant specific to this brief. Different environment or lighting mood from shot 1. Portrait orientation. No text overlays.",
      "Editorial campaign shot 3 — third outfit formula or close campaign frame specific to this brief. Portrait orientation. No text overlays."
    ],
    "flat_lays": [
      "Studio flat-lay — key garments from this look arranged artfully on a surface, highlighting fabric drape and construction detail specific to this brief. Top-down. No text.",
      "Accessory or texture flat-lay — specific bag, shoes, or luxury accessory from this look in a studio setting. Surface texture and lighting mood specific to this brief. No text."
    ],
    "atmosphere": [
      "Macro detail crop — specific hardware buckle, stitching, fabric weave, or luxury accessory texture from this look. Square crop. Extreme detail. No text.",
      "Atmosphere scene — destination or mood-setting location texture specific to this brief (e.g. a terracotta wall, sun-bleached cobblestone, sea light on linen). Cinematic crop. No text."
    ]
  }
}

Rules:
- the_look: exactly 8 items
- hero_looks image prompts: the model depicted must be a ${wearerNoun(g)}
- aesthetic_tags: ALL CAPS, 3–5 tags, relevant to THIS brief
- Never use generic descriptions — name cuts, fabrics, colours precisely
- Do NOT default to a London or Wimbledon aesthetic unless the brief says so`;

  const t0 = Date.now();

  let moodboardData;
  try {
    const MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'];
    const geminiCall = (model) => ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      // thinkingBudget:0 is mandatory here — gemini-2.5-flash counts thinking
      // tokens inside maxOutputTokens, so without it the large the_look JSON
      // truncates mid-object (JSON.parse throws / body arrives cut off) and the
      // call is slow enough to fall through to the pro model and blow the
      // gateway timeout. Every other JSON endpoint sets this; this one didn't.
      config: { systemInstruction: systemPrompt, maxOutputTokens: 5000, thinkingConfig: { thinkingBudget: 0 } },
    });
    let textResult;
    let lastErr;
    for (const model of MODELS) {
      for (let attempt = 0; attempt < 1; attempt++) {
        try {
          const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('text gen timeout')), 30000));
          textResult = await Promise.race([geminiCall(model), timeout]);
          const finishReason = textResult.candidates?.[0]?.finishReason;
          logAI({ feature: 'moodboard', stage: 'text', model, ms: Date.now() - t0, finishReason });
          if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
            throw new Error(`Gemini stopped: ${finishReason}`);
          }
          break;
        } catch (err) {
          lastErr = err;
          const errStr = err.message || '';
          const is503 = errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand') || errStr.includes('currently experiencing');
          const is429 = errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('quota');
          const isTimeout = errStr.includes('timeout');
          if (is503 || is429 || isTimeout) { console.warn(`[moodboard] retryable error on ${model} attempt ${attempt + 1}: ${errStr.slice(0, 80)}`); continue; }
          throw err;
        }
      }
      if (textResult) break;
      console.warn(`[moodboard] falling back from ${model}`);
    }
    if (!textResult) throw lastErr || new Error('All models unavailable');
    const raw = textResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) throw new Error('Empty response from Gemini');
    let jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    moodboardData = JSON.parse(jsonStr);
    if (!Array.isArray(moodboardData.the_look) || moodboardData.the_look.length < 6) {
      throw new Error(`Incomplete look data — got ${moodboardData.the_look?.length ?? 0} items`);
    }
  } catch (e) {
    logAI({ feature: 'moodboard', stage: 'text', success: false, ms: Date.now() - t0, reason: e.message });
    return res.status(500).json({ error: e.message || 'Failed to generate moodboard brief' });
  }

  // Match wardrobe items by category to look items
  const lookItems = moodboardData.the_look;
  for (const lookItem of lookItems) {
    const catLower = (lookItem.category || '').toLowerCase();
    const match = wardrobeItems.find(wi => {
      const wiCat = (wi.category || '').toLowerCase();
      const wiLabel = (wi.label || '').toLowerCase();
      return wiCat === catLower || catLower.includes(wiCat) || wiCat.includes(catLower) ||
             wiLabel.includes(catLower.replace(/s$/, ''));
    });
    lookItem.wardrobe_match = match
      ? { id: match.id, label: match.label, image_url: match.image_url || null, color: match.color || '' }
      : null;
  }

  // Respond immediately with text + look data — generate images in background
  // to avoid blocking the request and exhausting Gemini image quota during the
  // same window the style endpoint needs it.
  const mbJobId = randomBytes(6).toString('hex');
  imageJobs.set(mbJobId, { images: [], done: false, created: Date.now() });
  logAI({ feature: 'moodboard', stage: 'text_complete', totalMs: Date.now() - t0 });
  res.json({ ...moodboardData, the_look: lookItems, hero_image: null, grid_images: [], mb_job_id: mbJobId });

  // Background image generation — staggered to avoid bursting the Gemini rate limit
  const t1 = Date.now();
  const ip = moodboardData.image_prompts || {};
  const heroPrompts = Array.isArray(ip.hero_looks) ? ip.hero_looks.slice(0, 3) : [];
  const flatPrompts = Array.isArray(ip.flat_lays) ? ip.flat_lays.slice(0, 2) : [];
  const atmPrompts = Array.isArray(ip.atmosphere) ? ip.atmosphere.slice(0, 2) : [];

  const mbImageJobs = [
    ...heroPrompts.map(p => ({ type: 'hero_look', prompt: p })),
    ...flatPrompts.map(p => ({ type: 'flat_lay', prompt: p })),
    ...atmPrompts.map(p => ({ type: 'atmosphere', prompt: p })),
  ];

  (async () => {
    const results = [];
    for (let i = 0; i < mbImageJobs.length; i++) {
      const { type, prompt } = mbImageJobs[i];
      if (i > 0) await new Promise(r => setTimeout(r, 3000)); // 3s stagger between requests
      try {
        const r = await Promise.race([
          ai.models.generateContent({
            model: 'gemini-3.1-flash-image',
            contents: [{ role: 'user', parts: [{ text: `Editorial fashion photography. No text overlays. ${type === 'hero_look' ? `One woman, alone. ${FULL_BODY_FRAME} ` : ''}${prompt}` }] }],
            config: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
          new Promise(resolve => setTimeout(() => resolve(null), 45000)),
        ]);
        if (!r) { logAI({ feature: 'moodboard', stage: 'image', type, success: false, reason: 'timeout' }); results.push({ type, url: null }); continue; }
        const part = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!part?.inlineData) { logAI({ feature: 'moodboard', stage: 'image', type, success: false, reason: 'no_inline_data' }); results.push({ type, url: null }); continue; }
        const url = await cloudinaryUpload(part.inlineData.data, part.inlineData.mimeType);
        logAI({ feature: 'moodboard', stage: 'image', type, success: true, ms: Date.now() - t1 });
        results.push({ type, url });
        // Update job incrementally so client can poll for partial results
        const job = imageJobs.get(mbJobId);
        if (job) job.images = [...results];
      } catch (err) {
        logAI({ feature: 'moodboard', stage: 'image', type, success: false, reason: err.message });
        results.push({ type, url: null });
      }
    }
    const job = imageJobs.get(mbJobId);
    if (job) { job.images = results; job.done = true; }
    logAI({ feature: 'moodboard', stage: 'images_complete', totalMs: Date.now() - t0, count: results.filter(g => g.url).length });
  })();
});

app.post('/api/wardrobe/upload', async (req, res) => {
  const { data, mimeType } = req.body;
  if (!data || !mimeType) return res.status(400).json({ error: 'Missing data or mimeType' });
  if (!CLD_CLOUD || !CLD_KEY || !CLD_SECRET) {
    return res.status(500).json({ error: 'Cloudinary env vars not set on this deployment' });
  }
  const url = await cloudinaryUpload(data, mimeType);
  if (!url) return res.status(500).json({ error: 'Cloudinary upload failed — check server logs' });
  res.json({ url });
});

app.listen(port, () => {
  console.log(`Robes running at http://localhost:${port}`);
});

