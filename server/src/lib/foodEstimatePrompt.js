// Prompts for the AI food-photo estimate. Kept in their own module so the exact
// prompt text can be imported and unit-tested without pulling in the intake
// router (express, db, xp, streaks, achievements, ...).
//
// Rewritten for issue #9: the estimate must be honest and internally
// consistent. The model reasons in steps — identify the dish, estimate the
// portion weight in grams against a visual reference, recall per-100g nutrition,
// and reconcile the macros with the calorie figure — then emits a single raw
// JSON card. See server/src/routes/intake.js for how the card is parsed
// (parseEstimate) and served.

// One-shot nutritionist prompt — port of the image branch of
// dashboard/handlers/ai_chat.php. Forces a raw JSON object describing the food
// in the photo, now with a portion-grams estimate and a calorie/macro
// consistency requirement.
const ESTIMATE_BASE =
  'You are a professional Nutritionist AI. Analyze the food in the image and ' +
  'estimate the nutrition for the portion shown. Reason step by step in your ' +
  'mind, but reply with ONLY a raw JSON object (no markdown, no code fences, ' +
  'no explanation) of exactly this shape: ' +
  '{"food_name":"Name","portion_grams":0,"calories":0,"protein":0,"carbs":0,"fat":0,"unit":"1 serving","short_advice":"one short tip"}' +
  'Follow these steps before you output the JSON:' +
  '1) Identify the dish and any obvious ingredients.' +
  '2) Estimate the portion weight in GRAMS (portion_grams) using a visual ' +
  'reference in the photo (e.g. a rice cup ~150-200 g cooked, a palm-sized ' +
  'piece of meat ~120 g, a bowl of soup ~500-700 g). Give one best estimate.' +
  '3) Recall the nutrition per 100 g of the dish and scale it to that weight.' +
  '4) Make the numbers consistent: calories should equal protein*4 + carbs*4 ' +
  '+ fat*9 (kcal), within about 10 percent. Derive the macros from the ' +
  'calories rather than inventing four independent numbers.' +
  'If the image is NOT food, set every numeric field (including portion_grams) ' +
  'to 0 and food_name to "Not food".';

// Chat-oriented nutritionist prompt for /ai-chat — like ESTIMATE_BASE but uses
// the whole conversation so the user can correct the dish over multiple turns.
const CHAT_BASE =
  'You are a professional Nutritionist AI helping a user log a meal. Analyze ' +
  'the food in the image and/or the text the user sends, and use the whole ' +
  'conversation for context — the user may clarify or correct the dish (e.g. ' +
  '"it is actually pho bo"). Estimate the nutrition for the portion described. ' +
  'Reason step by step in your mind, but reply with ONLY a raw JSON object ' +
  '(no markdown, no code fences, no explanation) of exactly this shape: ' +
  '{"food_name":"Name","portion_grams":0,"calories":0,"protein":0,"carbs":0,"fat":0,"unit":"1 serving","short_advice":"one short tip"}' +
  'Follow these steps:' +
  '1) Identify the dish (incorporating any user corrections) and obvious ingredients.' +
  '2) Estimate the portion weight in GRAMS (portion_grams) using a visual ' +
  'reference; if the user stated an amount, trust theirs.' +
  '3) Recall nutrition per 100 g and scale to that weight.' +
  '4) Keep the numbers consistent: calories ≈ protein*4 + carbs*4 + fat*9 ' +
  '(within ~10 percent); derive the macros from the calories.' +
  'If you cannot identify a food yet, set food_name to null and put a short ' +
  'clarifying question in short_advice (all other numerics to 0). If the image ' +
  'is not food, set every numeric field (including portion_grams) to 0 and ' +
  'food_name to "Not food".';

export { ESTIMATE_BASE, CHAT_BASE };
