// Goal-planner math — ports dashboard/handlers/goal_plan.php (the parts the
// onboarding endpoint needs). BMR/TDEE → calorie goal, macros, hydration, and
// the user_plan_preferences upsert.
import { query } from '../db.js';
import { macroGoalsFromCalories } from './intake.js';
import { addDays, weekdayLabel } from './dates.js';

export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

export const GOAL_MODES = ['lose', 'maintain', 'gain'];

const GOAL_ADJUSTMENTS = { lose: -350, maintain: 0, gain: 300 };

function weeklyRateFromGoalMode(goalMode) {
  const daily = Math.abs(GOAL_ADJUSTMENTS[goalMode] ?? 0);
  if (daily <= 0) return 0;
  return Math.round(((daily * 7) / 7700) * 100) / 100;
}

function dailyAdjustmentFromWeeklyRate(goalMode, weeklyRate) {
  if (goalMode === 'maintain') return 0;
  const rate = Math.max(0, Math.min(1.5, weeklyRate));
  const daily = Math.round((rate * 7700) / 7);
  return goalMode === 'lose' ? -daily : daily;
}

// Mifflin-St Jeor, with the same gender offsets PHP uses.
function calculateBmr(age, gender, weightKg, heightCm) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (gender === 'female') return base - 161;
  if (gender === 'other') return base - 78;
  return base + 5;
}

function calculateTdee(bmr, activityLevel) {
  const factor = ACTIVITY_FACTORS[activityLevel] ?? ACTIVITY_FACTORS.moderately_active;
  return bmr * factor;
}

const clampGoal = (goal) => Math.max(800, Math.min(10000, goal));

// Mirrors plan_build_personal_plan().
export function buildPersonalPlan(age, gender, weightKg, heightCm, activityLevel, goalMode, weeklyRate = null) {
  if (!GOAL_MODES.includes(goalMode)) goalMode = 'maintain';
  if (!ACTIVITY_FACTORS[activityLevel]) activityLevel = 'moderately_active';

  const bmr = calculateBmr(age, gender, weightKg, heightCm);
  const tdee = calculateTdee(bmr, activityLevel);
  if (weeklyRate === null) weeklyRate = weeklyRateFromGoalMode(goalMode);
  const dailyAdjustment = dailyAdjustmentFromWeeklyRate(goalMode, weeklyRate);
  const calorieGoal = clampGoal(Math.round(tdee + dailyAdjustment));

  return {
    bmr,
    tdee,
    daily_adjustment: dailyAdjustment,
    calorie_goal: calorieGoal,
    macros: macroGoalsFromCalories(calorieGoal),
    hydration_ml: Math.round((weightKg * 35) / 250) * 250,
  };
}

// Mirrors plan_save_preferences() (INSERT ... ON DUPLICATE KEY UPDATE).
export async function savePreferences(userId, prefs) {
  let goalMode = GOAL_MODES.includes(prefs.goal_mode) ? prefs.goal_mode : 'lose';
  let activityLevel = ACTIVITY_FACTORS[prefs.activity_level] ? prefs.activity_level : 'moderately_active';

  let weeklyRate = Number.isFinite(Number(prefs.weekly_rate)) ? Number(prefs.weekly_rate) : 0.25;
  weeklyRate = Math.max(0, Math.min(1.5, weeklyRate));
  if (goalMode === 'maintain') weeklyRate = 0;

  let targetWeight = null;
  const tw = Number(prefs.target_weight);
  if (prefs.target_weight !== '' && prefs.target_weight != null && Number.isFinite(tw) && tw > 0 && tw <= 500) {
    targetWeight = tw;
  }

  await query(
    `INSERT INTO user_plan_preferences (user_id, goal_mode, weekly_rate, activity_level, target_weight)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       goal_mode = VALUES(goal_mode),
       weekly_rate = VALUES(weekly_rate),
       activity_level = VALUES(activity_level),
       target_weight = VALUES(target_weight)`,
    [userId, goalMode, weeklyRate, activityLevel, targetWeight]
  );
}

// ---- Goal Planner page helpers (the rest of goal_plan.php + dashboard-plan.php's
// inline logic that onboarding didn't need: read prefs, 7-day intake, ETA, notes) ----

// Mirrors plan_load_preferences(). Null when the user has no saved plan row yet.
export async function loadPreferences(userId) {
  const rows = await query(
    'SELECT goal_mode, weekly_rate, activity_level, target_weight FROM user_plan_preferences WHERE user_id = ?',
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    goal_mode: row.goal_mode,
    weekly_rate: Number(row.weekly_rate),
    activity_level: row.activity_level,
    target_weight: row.target_weight !== null ? Number(row.target_weight) : null,
  };
}

// 7-day intake summary (ports plan_recent_intake_summary). Day buckets are the
// user's LOCAL day via the same `date_intake + INTERVAL ? MINUTE` shift the rest of
// the app uses (req.tzShift, 0 for VN). Averages are over LOGGED days only.
export async function recentIntakeSummary(userId, endDate, shift = 0, days = 7) {
  const daily = [];
  let loggedDays = 0;
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;

  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(endDate, -i);
    const [row] = await query(
      `SELECT COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(protein),0) AS protein,
              COALESCE(SUM(carbs),0) AS carbs, COALESCE(SUM(fat),0) AS fat
         FROM intakeLog WHERE user_id = ? AND DATE(date_intake + INTERVAL ? MINUTE) = ?`,
      [userId, shift, date]
    );
    const calories = Number(row.calories);
    const protein = Number(row.protein);
    const carbs = Number(row.carbs);
    const fat = Number(row.fat);
    if (calories > 0) {
      loggedDays++;
      totalCalories += calories;
      totalProtein += protein;
      totalCarbs += carbs;
      totalFat += fat;
    }
    daily.push({
      date,
      label: weekdayLabel(date),
      calories,
      protein: Math.round(protein * 10) / 10,
      carbs: Math.round(carbs * 10) / 10,
      fat: Math.round(fat * 10) / 10,
    });
  }

  const avg = (sum) => (loggedDays > 0 ? Math.round((sum / loggedDays) * 10) / 10 : null);
  return {
    daily,
    logged_days: loggedDays,
    average_calories: loggedDays > 0 ? Math.round(totalCalories / loggedDays) : null,
    average_protein: avg(totalProtein),
    average_carbs: avg(totalCarbs),
    average_fat: avg(totalFat),
  };
}

// Ports plan_target_eta(). Returns null | { valid:false, code } | { valid:true,
// weeks, eta_date }. Pure weight math (kgChange / kg-per-week); the client formats
// eta_date with locale. todayDate is the user's local 'YYYY-MM-DD'.
export function targetEta(currentWeight, targetWeight, mode, weeklyRate, todayDate) {
  if (currentWeight == null || targetWeight == null || weeklyRate <= 0 || mode === 'maintain') return null;
  if (mode === 'lose' && targetWeight >= currentWeight) return { valid: false, code: 'lose_dir' };
  if (mode === 'gain' && targetWeight <= currentWeight) return { valid: false, code: 'gain_dir' };
  const kgChange = Math.abs(targetWeight - currentWeight);
  if (kgChange <= 0) return null;
  const weeks = kgChange / weeklyRate;
  const days = Math.ceil(weeks * 7);
  return { valid: true, weeks: Math.round(weeks * 10) / 10, eta_date: addDays(todayDate, days) };
}

// Ports the planNotes chain in dashboard-plan.php. Returns [{ code, params? }] for
// the client to render via i18n (keeps copy on the client). Order matches PHP.
export function buildPlanNotes({ rawGoal, recommendedGoal, averageCalories, goalMode, weeklyRate, currentGoal, eta }) {
  const notes = [];
  if (rawGoal !== recommendedGoal) notes.push({ code: 'clamped' });

  if (averageCalories == null) {
    notes.push({ code: 'need_logs' });
  } else {
    const gap = averageCalories - recommendedGoal;
    if (Math.abs(gap) <= 100) notes.push({ code: 'close' });
    else if (gap > 0) notes.push({ code: 'above', params: { n: Math.abs(gap) } });
    else notes.push({ code: 'below', params: { n: Math.abs(gap) } });
  }

  if (goalMode === 'lose' && weeklyRate >= 0.75) notes.push({ code: 'aggressive_lose' });
  if (goalMode === 'gain' && weeklyRate >= 0.75) notes.push({ code: 'aggressive_gain' });

  if (currentGoal != null && Math.abs(currentGoal - recommendedGoal) >= 150) {
    const delta = Math.abs(recommendedGoal - currentGoal);
    notes.push({ code: recommendedGoal > currentGoal ? 'delta_higher' : 'delta_lower', params: { n: delta } });
  }

  if (eta && !eta.valid) notes.push({ code: eta.code === 'gain_dir' ? 'eta_gain_dir' : 'eta_lose_dir' });
  return notes;
}

// Ports plan_weight_summary(). The last 8 weight logs -> current, trend (current
// minus the oldest in the window), and a chart series ordered oldest..newest.
// fallbackWeight (the profile weight) stands in for `current` when there are no
// logs yet. weight_log.date_logged is the user's local day (no tz shift needed).
export async function weightSummary(userId, fallbackWeight = null) {
  const rows = await query(
    'SELECT weight, date_logged FROM weight_log WHERE user_id = ? ORDER BY date_logged DESC, weight_id DESC LIMIT 8',
    [userId]
  );
  if (!rows.length) {
    return {
      current: fallbackWeight != null && fallbackWeight > 0 ? Number(fallbackWeight) : null,
      current_date: null,
      trend: null,
      chart: [],
    };
  }
  const current = Number(rows[0].weight);
  const oldest = Number(rows[rows.length - 1].weight);
  const chart = rows
    .slice()
    .reverse()
    .map((r) => ({ date: String(r.date_logged).slice(0, 10), weight: Number(r.weight) }));
  return {
    current,
    current_date: String(rows[0].date_logged).slice(0, 10),
    trend: Math.round((current - oldest) * 10) / 10,
    chart,
  };
}
