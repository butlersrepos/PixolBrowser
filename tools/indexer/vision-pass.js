#!/usr/bin/env node
// OPTIONAL descriptive-tag pass — Claude looks at the pixels and adds tags the
// filenames never contain (materials, mood, palette, setting: "mossy",
// "torch-lit", "ornate", "gothic"). It does NOT re-run the deterministic index.
//
//   node vision-pass.js               # DRY RUN: pick representatives, print cost
//   node vision-pass.js --run         # actually call the API (needs ANTHROPIC_API_KEY)
//   node vision-pass.js --run --limit 50   # cap for a cheap trial
//
// Cost control by design: it does NOT look at all ~11.5k images. It picks ONE
// representative per asset group (per directory — an idle frame, a tileset, an
// effect strip), because a character's Idle/Walk/Attack look the same to a
// descriptive tagger. Descriptive tags are written per group and fanned out to
// its files in an *enriched* copy of the index; the base index is untouched.
//
// Uses raw HTTPS to keep the indexer zero-dependency (the wire format is the
// Messages API; swap in @anthropic-ai/sdk if you prefer). Model defaults to
// claude-sonnet-5 — the representative-only Sonnet pass we costed at ~$2-3 total.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
const INDEX = path.join(OUT, 'minifantasy-index.jsonl');
const TAGS_OUT = path.join(OUT, 'vision-tags.json');          // { groupDir: [tags] }
const ENRICHED = path.join(OUT, 'minifantasy-index.enriched.jsonl');
const ASSETS_ROOT = process.argv.includes('--assets')
  ? process.argv[process.argv.indexOf('--assets') + 1]
  : path.join(require('os').homedir(), 'dev/pixel-art/MiniFantasy');

const MODEL = process.env.VISION_MODEL || 'claude-sonnet-5';
const RUN = process.argv.includes('--run');
const LIMIT = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1], 10) : Infinity;
const CONCURRENCY = 4;

// Descriptive vocabulary we ask for — deliberately the stuff paths don't encode.
const PROMPT = `You are tagging a single pixel-art sprite/sheet for an asset library.
Give 3-8 SHORT lowercase descriptive tags a game dev would search by that are NOT
already obvious from a filename — focus on: material (stone, wood, metal, bone,
crystal, cloth), setting/biome (forest, desert, cavern, swamp, snow, lava),
mood/style (gothic, ornate, rustic, cute, grim, ancient, ruined), palette
(warm, cool, muted, vibrant, monochrome), and notable features (mossy, cracked,
glowing, torch-lit, bloody, gilded). Do NOT repeat the subject or animation
(no "goblin", "idle", "tileset"). Output only the tags.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { tags: { type: 'array', items: { type: 'string' } } },
  required: ['tags'],
};

function loadIndex() {
  return fs.readFileSync(INDEX, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

// One representative per directory: prefer a non-excluded PNG, an idle frame if
// present, else the first alphabetically.
function pickRepresentatives(records) {
  const byDir = new Map();
  for (const r of records) {
    const dir = path.dirname(r.path);
    (byDir.get(dir) || byDir.set(dir, []).get(dir)).push(r);
  }
  const reps = [];
  for (const [dir, recs] of byDir) {
    const pool = recs.filter((r) => r.ext === 'png' && !r.excluded);
    const cand = pool.length ? pool : recs;
    cand.sort((a, b) => {
      const ai = a.tags.includes('idle') ? 0 : 1;
      const bi = b.tags.includes('idle') ? 0 : 1;
      return ai - bi || a.path.localeCompare(b.path);
    });
    reps.push({ dir, rec: cand[0], count: recs.length });
  }
  return reps;
}

function estimate(reps) {
  // ~91 img tokens (measured) + ~220 prompt/schema + ~60 output per call.
  const inTok = reps.length * (91 + 220);
  const outTok = reps.length * 60;
  const price = { // $/1M [in, out]
    'claude-sonnet-5': [2, 10], 'claude-haiku-4-5': [1, 5], 'claude-opus-4-8': [5, 25],
  }[MODEL] || [2, 10];
  const usd = (inTok / 1e6) * price[0] + (outTok / 1e6) * price[1];
  return { inTok, outTok, usd };
}

async function tagImage(absPath) {
  const b64 = fs.readFileSync(absPath).toString('base64');
  const body = {
    model: MODEL,
    max_tokens: 200,
    thinking: { type: 'disabled' }, // simple perception; keep it cheap/fast
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json();
  const txt = (data.content || []).find((b) => b.type === 'text')?.text || '{}';
  return (JSON.parse(txt).tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
}

async function pool(items, worker, n) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await worker(items[idx], idx); }
      catch (e) { results[idx] = { error: e.message }; }
    }
  }));
  return results;
}

async function main() {
  if (!fs.existsSync(INDEX)) { console.error('Run index-minifantasy.js first.'); process.exit(1); }
  const records = loadIndex();
  let reps = pickRepresentatives(records);

  const existing = fs.existsSync(TAGS_OUT) ? JSON.parse(fs.readFileSync(TAGS_OUT, 'utf8')) : {};
  reps = reps.filter((r) => !existing[r.dir]); // resume: skip already-tagged groups
  if (Number.isFinite(LIMIT)) reps = reps.slice(0, LIMIT);

  const est = estimate(reps);
  console.log(`Representatives to tag: ${reps.length}  (model: ${MODEL})`);
  console.log(`Est. tokens: ~${est.inTok.toLocaleString()} in / ~${est.outTok.toLocaleString()} out`);
  console.log(`Est. cost:   ~$${est.usd.toFixed(2)}  (halve with the Batch API)`);
  if (!RUN) {
    console.log('\nDRY RUN. Re-run with --run to call the API (needs ANTHROPIC_API_KEY).');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY.'); process.exit(1); }

  const tags = { ...existing };
  let done = 0;
  await pool(reps, async (r) => {
    const abs = path.join(ASSETS_ROOT, r.dir, path.basename(r.rec.path));
    const t = await tagImage(path.join(ASSETS_ROOT, r.rec.path));
    tags[r.dir] = t;
    if (++done % 25 === 0) {
      fs.writeFileSync(TAGS_OUT, JSON.stringify(tags, null, 0));
      process.stderr.write(`  tagged ${done}/${reps.length}\n`);
    }
    return t;
  }, CONCURRENCY);
  fs.writeFileSync(TAGS_OUT, JSON.stringify(tags, null, 2));

  // Fan out group tags to every file in that group, in an enriched copy.
  const enriched = records.map((rec) => {
    const dir = path.dirname(rec.path);
    const dt = tags[dir];
    return dt && dt.length ? { ...rec, desc: dt } : rec;
  });
  fs.writeFileSync(ENRICHED, enriched.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nWrote ${TAGS_OUT}\nWrote ${ENRICHED}  (base index untouched)`);
}

main();
