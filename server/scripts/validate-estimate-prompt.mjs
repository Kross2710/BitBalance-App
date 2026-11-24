// Validates a rewritten food-estimate prompt against the REAL Gemini model,
// exactly as server/src/lib/aiProvider.js calls it. Reusable harness for issue
// #9-style prompt work: import the real prompt, mirror the production call, feed
// real images, and assert on structured output the way production parses it.
//
//   node server/scripts/validate-estimate-prompt.mjs [options] <imagePath>...
//
// Options:
//   --negative <path>   Mark an image as an expected NON-FOOD case (repeatable).
//   --chat              Also validate CHAT_BASE (multi-turn /ai-chat prompt).
//                       Default validates ESTIMATE_BASE (one-shot prompt).
//   --temp <n>          Extra temperature to test (repeatable; default 0.7, 0.3).
//
// Reads GEMINI_API_KEY / AI_COACH_MODEL from the environment, falling back to
// server/.env. Never fabricates results — exits non-zero if any check fails.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ESTIMATE_BASE, CHAT_BASE } from '../src/lib/foodEstimatePrompt.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (KEY=VALUE, ignores blanks/comments/quotes).
function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* missing .env is fine if env vars are set */
  }
  return out;
}

const ENV = loadEnv(join(SCRIPT_DIR, '..', '.env'));
const KEY = process.env.GEMINI_API_KEY || ENV.GEMINI_API_KEY;
const MODEL = process.env.AI_COACH_MODEL || ENV.AI_COACH_MODEL || 'gemini-3.5-flash-lite';
const MAX_TOKENS = 1024;

const args = process.argv.slice(2);
const negatives = new Set();
const temps = new Set(['0.7', '0.3']);
const prompts = new Set(['estimate']); // add 'chat' via --chat
const images = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--negative') negatives.add(args[++i]);
  else if (a === '--chat') prompts.add('chat');
  else if (a === '--temp') temps.add(args[++i]);
  else images.push(a);
}

if (!KEY) {
  console.error('Set GEMINI_API_KEY (and optionally AI_COACH_MODEL) in the environment or server/.env.');
  process.exit(1);
}
if (!images.length) {
  console.error('Pass at least one image path, e.g. node server/scripts/validate-estimate-prompt.mjs pho.jpg');
  process.exit(2);
}

// ---- static checks: the prompt must actually contain the new instructions ----
const STATIC = [
  ['asks for portion_grams', /portion_grams/],
  ['anchors to per-100g', /per 100 g|per-100g/i],
  ['requires calorie/macro consistency', /\*4.*\*4.*\*9|consistent/i],
  ['uses step-by-step reasoning', /step by step/i],
];
const promptText = {
  estimate: ESTIMATE_BASE,
  chat: CHAT_BASE,
};

// ---- parse the model reply the same way server/src/lib/intake.js does ----
function parseReply(text) {
  let txt = String(text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  const m = /\{[\s\S]*\}/.exec(txt);
  if (m) txt = m[0];
  try {
    return { ok: true, data: JSON.parse(txt) };
  } catch {
    return { ok: false, data: null };
  }
}

function macroKcal(d) {
  return (Number(d.protein) || 0) * 4 + (Number(d.carbs) || 0) * 4 + (Number(d.fat) || 0) * 9;
}

async function callGemini(system, image, temperature) {
  // Mirrors callGemini() in server/src/lib/aiProvider.js byte-for-byte.
  const contents = [
    {
      role: 'user',
      parts: [
        { text: 'Estimate the food in this photo.' },
        { inline_data: { mime_type: image.mime, data: image.data } },
      ],
    },
  ];
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature, maxOutputTokens: MAX_TOKENS },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function loadImg(path) {
  const buf = readFileSync(path);
  return { path, mime: 'image/jpeg', data: buf.toString('base64'), bytes: buf.length };
}

// ---- run ----
let allPass = true;

for (const promptName of prompts) {
  const system = promptText[promptName];
  for (const [label, re] of STATIC) {
    const ok = re.test(system);
    console.log(`[${promptName}] static  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  }

  for (const img of images.map(loadImg)) {
    const negative = negatives.has(img.path);
    console.log(`\n[${promptName}] == ${img.path} (${negative ? 'NON-FOOD' : 'food'}) ==`);
    for (const temp of temps) {
      const t = Number(temp);
      const raw = await callGemini(system, img, t);
      const { ok, data } = parseReply(raw);
      if (!ok) {
        console.log(`  temp=${temp}  FAIL  (unparseable JSON: ${String(raw).slice(0, 80)})`);
        allPass = false;
        continue;
      }
      const kcal = macroKcal(data);
      const cal = Number(data.calories) || 0;
      const consistencyPct = cal > 0 ? Math.abs(kcal - cal) / cal * 100 : null;
      const consistent = consistencyPct != null && consistencyPct <= 40;
      const isNotFood = data.food_name === 'Not food';
      const allZero = [data.portion_grams, data.calories, data.protein, data.carbs, data.fat].every((v) => Number(v) === 0);

      console.log(`  temp=${temp}`);
      console.log(`        food_name      = ${JSON.stringify(data.food_name)}`);
      console.log(`        portion_grams  = ${data.portion_grams}`);
      console.log(`        calories       = ${cal}   (P${data.protein}/C${data.carbs}/F${data.fat})`);
      console.log(`        macros->kcal   = ${kcal}   consistency = ${consistencyPct == null ? 'n/a' : consistencyPct.toFixed(1) + '%'}`);

      let pass = true;
      if (negative) pass = isNotFood && allZero;
      else pass = Boolean(data.food_name) && data.portion_grams > 0 && consistent;

      console.log(`        => ${pass ? 'PASS' : 'FAIL'}  (${negative ? 'expects Not-food + zeros' : 'expects name + grams + consistent'})`);
      if (!pass) allPass = false;
    }
  }
}

console.log(`\n== RESULT: ${allPass ? 'ALL PASS' : 'SOME FAILURES'} (model=${MODEL}) ==`);
process.exit(allPass ? 0 : 1);
