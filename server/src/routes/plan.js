// Goal Planner routes — port of dashboard-plan.php (+ apply_plan_goal.php).
// GET /api/plan      — snapshot: physical, current goal, saved prefs, computed plan,
//                      7-day intake summary, ETA, coach notes.
// POST /api/plan/preview — recompute plan + notes from adjusted inputs (no writes).
// POST /api/plan/apply   — save the inputs as preferences + append a new userGoal.
//
// Physical info (age/gender/weight/height) is read from the DB, not the request —
// only the four plan inputs come from the body. buildPersonalPlan/savePreferences
// already live in lib/plan.js (shared with onboarding); this adds the page glue.
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  ACTIVITY_FACTORS,
  GOAL_MODES,
  buildPersonalPlan,
  savePreferences,
  loadPreferences,
  recentIntakeSummary,
  targetEta,
  buildPlanNotes,
} from '../lib/plan.js';
import { physicalInfo } from '../lib/dashboard.js';

const router = Router();

const DEFAULT_PREFS = { goal_mode: 'lose', weekly_rate: 0.25, activity_level: 'moderately_active', target_weight: null };

// Validate the four plan inputs (physical info is read from the DB separately).
// Mirrors the maintain-clamps-rate rule from onboarding's readOnboardingInput.
function readPlanInput(body) {
  const activityLevel = String(body?.activity_level ?? '').trim();
  const goalMode = String(body?.goal_mode ?? '').trim();
  let weeklyRate = body?.weekly_rate === '' || body?.weekly_rate == null ? null : Number(body.weekly_rate);
  let targetWeight = body?.target_weight === '' || body?.target_weight == null ? null : Number(body.target_weight);

  if (!ACTIVITY_FACTORS[activityLevel]) return { error: 'Please choose an activity level.' };
  if (!GOAL_MODES.includes(goalMode)) return { error: 'Please choose a goal.' };

  if (goalMode === 'maintain') {
    weeklyRate = 0;
    targetWeight = null;
  } else {
    if (weeklyRate == null || !Number.isFinite(weeklyRate)) return { error: 'Please choose a weekly pace.' };
    weeklyRate = Math.max(0, Math.min(1.5, weeklyRate));
    // A lose/gain plan needs a real pace; a 0 here (e.g. carried over from a prior
    // maintain plan) would silently recommend maintenance calories. Fall back to the
    // default pace like a brand-new user, so the API can't emit a zero-deficit plan.
    if (weeklyRate <= 0) weeklyRate = DEFAULT_PREFS.weekly_rate;
  }
  if (targetWeight != null && (!Number.isFinite(targetWeight) || targetWeight <= 0 || targetWeight > 500)) {
    targetWeight = null;
  }
  return { values: { activityLevel, goalMode, weeklyRate, targetWeight } };
}

async function latestGoal(userId) {
  // date_set is second-precision, so two goals applied in the same second tie; the
  // userGoal_id tiebreaker (as in profile.js) makes /apply reliably read back the
  // row it just inserted rather than an older same-second goal.
  const rows = await query(
    'SELECT calorie_goal FROM userGoal WHERE user_id = ? ORDER BY date_set DESC, userGoal_id DESC LIMIT 1',
    [userId]
  );
  return rows[0]?.calorie_goal != null ? Number(rows[0].calorie_goal) : null;
}

const physicalReady = (p) => p.age != null && p.gender != null && p.weight != null && p.height != null;

// Compute the recommendation (plan + ETA + notes) from physical info + inputs.
// averageCalories feeds the "above/below your average" note; pass null to skip it.
function computePlan(physical, inputs, goal, averageCalories, todayDate) {
  if (!physicalReady(physical)) return { physical_ready: false, plan: null, target_eta: null, notes: [] };

  const raw = buildPersonalPlan(
    physical.age,
    physical.gender,
    physical.weight,
    physical.height,
    inputs.activityLevel,
    inputs.goalMode,
    inputs.weeklyRate
  );
  const rawGoal = Math.round(raw.tdee + raw.daily_adjustment); // pre-clamp, to detect the clamped note
  const eta = targetEta(physical.weight, inputs.targetWeight, inputs.goalMode, inputs.weeklyRate, todayDate);
  const notes = buildPlanNotes({
    rawGoal,
    recommendedGoal: raw.calorie_goal,
    averageCalories,
    goalMode: inputs.goalMode,
    weeklyRate: inputs.weeklyRate,
    currentGoal: goal,
    eta,
  });

  return {
    physical_ready: true,
    plan: {
      bmr: Math.round(raw.bmr),
      tdee: Math.round(raw.tdee),
      daily_adjustment: raw.daily_adjustment, // signed; client shows the magnitude
      calorie_goal: raw.calorie_goal,
      macros: raw.macros,
      weekly_target: raw.calorie_goal * 7,
    },
    target_eta: eta,
    notes,
  };
}

// The full page snapshot used by GET and returned after /apply.
async function buildSnapshot(userId, req) {
  const physical = await physicalInfo(userId);
  const saved = (await loadPreferences(userId)) || { ...DEFAULT_PREFS };
  const goal = await latestGoal(userId);
  const intake = await recentIntakeSummary(userId, req.todayTz, req.tzShift);

  const inputs = {
    activityLevel: ACTIVITY_FACTORS[saved.activity_level] ? saved.activity_level : DEFAULT_PREFS.activity_level,
    goalMode: GOAL_MODES.includes(saved.goal_mode) ? saved.goal_mode : DEFAULT_PREFS.goal_mode,
    weeklyRate: saved.goal_mode === 'maintain' ? 0 : Number(saved.weekly_rate ?? DEFAULT_PREFS.weekly_rate),
    targetWeight: saved.target_weight ?? null,
  };
  const computed = computePlan(physical, inputs, goal, intake.average_calories, req.todayTz);

  return {
    physical,
    physical_ready: computed.physical_ready,
    current_goal: goal,
    preferences: {
      goal_mode: inputs.goalMode,
      weekly_rate: inputs.weeklyRate,
      activity_level: inputs.activityLevel,
      target_weight: inputs.targetWeight,
    },
    plan: computed.plan,
    target_eta: computed.target_eta,
    notes: computed.notes,
    intake_summary: intake,
  };
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, data: await buildSnapshot(req.user.user_id, req), message: null });
  } catch (err) {
    next(err);
  }
});

// Live recommendation as the user drags the inputs. No DB writes. The client echoes
// the average_calories it already has so we don't re-scan 7 days on every keystroke.
router.post('/preview', requireAuth, async (req, res, next) => {
  try {
    const { error, values } = readPlanInput(req.body);
    if (error) return res.status(422).json({ ok: false, data: null, message: error });

    const physical = await physicalInfo(req.user.user_id);
    const goal = await latestGoal(req.user.user_id);
    const avg =
      req.body?.average_calories === '' || req.body?.average_calories == null ? null : Number(req.body.average_calories);
    const computed = computePlan(physical, values, goal, Number.isFinite(avg) ? avg : null, req.todayTz);

    res.json({ ok: true, data: computed, message: null });
  } catch (err) {
    next(err);
  }
});

// Persist the chosen inputs as preferences and append the recommended calorie goal
// (history-preserving, like onboarding/profile). Returns a fresh snapshot.
router.post('/apply', requireAuth, async (req, res, next) => {
  try {
    const { error, values } = readPlanInput(req.body);
    if (error) return res.status(422).json({ ok: false, data: null, message: error });

    const physical = await physicalInfo(req.user.user_id);
    if (!physicalReady(physical)) {
      return res.status(422).json({ ok: false, data: null, message: 'Body metrics are needed to apply a plan.' });
    }

    const plan = buildPersonalPlan(
      physical.age,
      physical.gender,
      physical.weight,
      physical.height,
      values.activityLevel,
      values.goalMode,
      values.weeklyRate
    );

    // Prefs write is best-effort (matches onboarding): a failure here must not block
    // the goal from being applied.
    try {
      await savePreferences(req.user.user_id, {
        goal_mode: values.goalMode,
        weekly_rate: values.weeklyRate,
        activity_level: values.activityLevel,
        target_weight: values.targetWeight,
      });
    } catch (e) {
      console.error('Plan prefs save failed:', e);
    }

    await query('INSERT INTO userGoal (user_id, calorie_goal, date_set) VALUES (?, ?, NOW())', [
      req.user.user_id,
      plan.calorie_goal,
    ]);

    res.json({ ok: true, data: await buildSnapshot(req.user.user_id, req), message: null });
  } catch (err) {
    next(err);
  }
});

export default router;
