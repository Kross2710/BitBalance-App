<script setup>
// Goal Planner tab — ports dashboard-plan.php as an interactive panel inside the
// Coach hub. Adjust goal mode / activity / weekly pace / target weight, see the
// recommendation recompute live (debounced /preview), then Apply to set the daily
// calorie goal. Physical metrics come from the profile; when they're missing the
// panel shows a "needs metrics" prompt instead.
import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../lib/api.js';
import { t, locale } from '../i18n/index.js';
import { celebrate } from '../lib/unlockToast.js';
import UnlockToast from './UnlockToast.vue';

const GOAL_MODES = [
  { key: 'lose', icon: 'fa-arrow-trend-down' },
  { key: 'maintain', icon: 'fa-scale-balanced' },
  { key: 'gain', icon: 'fa-arrow-trend-up' },
];
const ACTIVITY_LEVELS = ['sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active'];

const loading = ref(true);
const error = ref('');
const applying = ref(false);
const flash = ref('');
let flashTimer = null;
const weightInput = ref('');
const loggingWeight = ref(false);
const weightFlash = ref('');
let weightFlashTimer = null;
const SPARK_W = 280;
const SPARK_H = 44;
// Macro split editor: protein% + fat% are the free inputs, carbs% is the remainder
// (so the split always sums to 100% of the calorie goal). Grams are computed from %.
const macroPct = reactive({ protein: 30, fat: 25 });
const applyingMacros = ref(false);
const macroFlash = ref('');
const macroError = ref('');
let macroFlashTimer = null;

const snapshot = ref(null); // full GET payload (physical, current_goal, intake_summary, ...)
const plan = ref(null); // live recommendation (GET, then /preview)
const targetEta = ref(null);
const notes = ref([]);

const form = reactive({ goal_mode: 'lose', activity_level: 'moderately_active', weekly_rate: 0.25, target_weight: '' });

let previewTimer = null;
let suppress = true; // gate the input watcher while we seed the form from the snapshot

const physicalReady = computed(() => !!snapshot.value?.physical_ready);
const isMaintain = computed(() => form.goal_mode === 'maintain');

const inputPayload = () => ({
  goal_mode: form.goal_mode,
  activity_level: form.activity_level,
  weekly_rate: isMaintain.value ? 0 : Number(form.weekly_rate),
  target_weight: form.target_weight === '' ? null : Number(form.target_weight),
});

async function load() {
  loading.value = true;
  error.value = '';
  suppress = true;
  try {
    const data = await api.get('/api/plan', { background: true });
    snapshot.value = data;
    const p = data.preferences;
    form.goal_mode = p.goal_mode;
    form.activity_level = p.activity_level;
    form.weekly_rate = p.weekly_rate ?? 0.25;
    form.target_weight = p.target_weight ?? '';
    plan.value = data.plan;
    targetEta.value = data.target_eta;
    notes.value = data.notes;
    seedMacroPct(data.current_macros, data.current_goal);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
    await nextTick();
    suppress = false; // any change after this point is a real user edit
  }
}

// Seed the % inputs from the current stored/derived macro goals so the editor opens
// reflecting what's in effect. carbs% is derived, so only protein% + fat% are seeded.
function seedMacroPct(macros, goal) {
  if (!goal || !macros) return;
  macroPct.protein = Math.round(((Number(macros.protein) * 4) / goal) * 100);
  macroPct.fat = Math.round(((Number(macros.fat) * 9) / goal) * 100);
}
onMounted(load);

async function runPreview() {
  if (!physicalReady.value) return;
  try {
    const data = await api.post(
      '/api/plan/preview',
      { ...inputPayload(), average_calories: snapshot.value?.intake_summary?.average_calories ?? null },
      { background: true }
    );
    plan.value = data.plan;
    targetEta.value = data.target_eta;
    notes.value = data.notes;
  } catch (e) {
    error.value = e.message;
  }
}

watch(
  () => [form.goal_mode, form.activity_level, form.weekly_rate, form.target_weight],
  () => {
    if (suppress) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 250);
  }
);

// A saved maintain plan persists weekly_rate 0; switching to lose/gain would then
// recommend maintenance calories (0 deficit) until the slider is nudged. Re-seed a
// sane pace when leaving maintain without one. (The input watcher above picks up
// the change and re-previews.)
watch(
  () => form.goal_mode,
  (mode) => {
    if (mode !== 'maintain' && !(Number(form.weekly_rate) > 0)) form.weekly_rate = 0.25;
  }
);

async function applyPlan() {
  if (applying.value || !physicalReady.value) return;
  error.value = '';
  applying.value = true;
  try {
    const data = await api.post('/api/plan/apply', inputPayload());
    snapshot.value = data;
    plan.value = data.plan;
    targetEta.value = data.target_eta;
    notes.value = data.notes;
    flash.value = t('plan.applied', { n: data.current_goal });
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash.value = ''), 4000);
  } catch (e) {
    error.value = e.message;
  } finally {
    applying.value = false;
  }
}

async function logWeight() {
  const w = Number(weightInput.value);
  if (loggingWeight.value || !(w > 0)) return;
  error.value = '';
  loggingWeight.value = true;
  try {
    const data = await api.post('/api/plan/weight', { weight: w });
    snapshot.value = data;
    // The server consumed the level-up flash on this response, so surface it here
    // (matches IntakeView) — otherwise a weight-log level-up would be lost.
    if (data.xp?.levelup) celebrate([{ type: 'levelup', level: data.xp.levelup.to }]);
    weightInput.value = '';
    // The new weight shifts BMR + ETA, so recompute the recommendation for the
    // inputs currently on screen (which may differ from the saved prefs).
    await runPreview();
    const xp = data.xp?.added || 0;
    weightFlash.value = xp > 0 ? t('plan.weight.logged_xp', { n: xp }) : t('plan.weight.logged');
    clearTimeout(weightFlashTimer);
    weightFlashTimer = setTimeout(() => (weightFlash.value = ''), 4000);
  } catch (e) {
    error.value = e.message;
  } finally {
    loggingWeight.value = false;
  }
}

async function applyMacros() {
  if (applyingMacros.value || !macroGoalGrams.value.valid) return;
  macroError.value = '';
  applyingMacros.value = true;
  try {
    const g = macroGoalGrams.value;
    const data = await api.post('/api/plan/macros', { protein: g.protein, carbs: g.carbs, fat: g.fat });
    snapshot.value = data;
    seedMacroPct(data.current_macros, data.current_goal);
    macroFlash.value = t('plan.macros.saved');
    clearTimeout(macroFlashTimer);
    macroFlashTimer = setTimeout(() => (macroFlash.value = ''), 4000);
  } catch (e) {
    macroError.value = e.message;
  } finally {
    applyingMacros.value = false;
  }
}

// Chart scale includes the goal line so it always sits within the bar band.
const goalLineValue = computed(() => snapshot.value?.current_goal || plan.value?.calorie_goal || 0);
const chartMax = computed(() => {
  const cals = snapshot.value?.intake_summary?.daily?.map((d) => d.calories) ?? [0];
  return Math.max(1, ...cals, goalLineValue.value);
});
const adjustmentLabelKey = computed(() =>
  form.goal_mode === 'gain' ? 'plan.stat.surplus' : form.goal_mode === 'lose' ? 'plan.stat.deficit' : 'plan.stat.adjustment'
);
const etaDateLabel = computed(() => {
  if (!targetEta.value?.valid) return '';
  return new Date(targetEta.value.eta_date + 'T00:00:00').toLocaleDateString(locale.value === 'vi' ? 'vi-VN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
});

// BMI + healthy-weight range from the profile metrics already in the snapshot
// (pure display, no extra request). Bands: <18.5 under, <25 normal, <30 over, else obese.
const bmi = computed(() => {
  const w = Number(snapshot.value?.physical?.weight);
  const h = Number(snapshot.value?.physical?.height);
  if (!(w > 0) || !(h > 0)) return null;
  const m = h / 100;
  const value = w / (m * m);
  const category = value < 18.5 ? 'underweight' : value < 25 ? 'normal' : value < 30 ? 'overweight' : 'obese';
  return {
    value: Math.round(value * 10) / 10,
    category,
    idealMin: Math.round(18.5 * m * m),
    idealMax: Math.round(24.9 * m * m),
  };
});

const weightSummary = computed(() => snapshot.value?.weight_summary || null);
const trendIcon = computed(() => {
  const tr = weightSummary.value?.trend;
  if (tr == null || tr === 0) return 'fa-minus';
  return tr < 0 ? 'fa-arrow-down' : 'fa-arrow-up';
});
// Weight sparkline: scale to the window's own min/max so small changes are visible
// (a 0-based scale would flatten a 70.x kg trend). Polyline, oldest -> newest.
const sparkPoints = computed(() => {
  const ws = (weightSummary.value?.chart || []).map((c) => c.weight);
  if (ws.length < 2) return '';
  const min = Math.min(...ws);
  const max = Math.max(...ws);
  const range = max - min || 1;
  const pad = 6;
  return ws
    .map((w, i) => {
      const x = (i / (ws.length - 1)) * SPARK_W;
      const y = pad + (1 - (w - min) / range) * (SPARK_H - 2 * pad);
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(' ');
});

// Grams for the chosen % split against the current calorie goal. carbs% is the
// remainder; the split is valid when protein% + fat% <= 100 and a goal exists.
const macroGoalGrams = computed(() => {
  const goal = snapshot.value?.current_goal || 0;
  const p = Math.max(0, Number(macroPct.protein) || 0);
  const f = Math.max(0, Number(macroPct.fat) || 0);
  const carbsPct = Math.max(0, 100 - p - f);
  const protein = Math.round(((p / 100) * goal) / 4);
  const carbs = Math.round(((carbsPct / 100) * goal) / 4);
  const fat = Math.round(((f / 100) * goal) / 9);
  // The server bounds each macro to 0-999 g; for a very high calorie goal an
  // extreme split can exceed that, so guard it here too rather than 422 on save.
  let warn = null;
  if (p + f > 100) warn = 'over_100';
  else if (protein > 999 || carbs > 999 || fat > 999) warn = 'too_high';
  return { protein, carbs, fat, carbsPct, warn, valid: goal > 0 && !warn };
});
</script>

<template>
  <div class="plan-panel">
    <p v-if="loading" class="muted center pad">{{ $t('common.loading') }}</p>
    <p v-else-if="error && !snapshot" class="error pad">{{ error }}</p>

    <div v-else class="plan-scroll">
      <!-- Needs body metrics -->
      <section v-if="!physicalReady" class="card plan-empty">
        <i class="fa-solid fa-user-pen" />
        <strong>{{ $t('plan.needs_metrics.title') }}</strong>
        <p class="muted">{{ $t('plan.needs_metrics.body') }}</p>
        <RouterLink to="/profile" class="link-btn">{{ $t('plan.needs_metrics.cta') }}</RouterLink>
      </section>

      <template v-else>
        <!-- Hero metrics strip -->
        <div class="metrics">
          <div class="metric">
            <span class="muted">{{ $t('plan.metric.current_goal') }}</span>
            <strong>{{ snapshot.current_goal ? snapshot.current_goal + ' ' + $t('common.kcal') : $t('plan.metric.unset') }}</strong>
          </div>
          <div class="metric">
            <span class="muted">{{ $t('plan.metric.7day_avg') }}</span>
            <strong>{{ snapshot.intake_summary.average_calories != null ? snapshot.intake_summary.average_calories + ' ' + $t('common.kcal') : '—' }}</strong>
          </div>
          <div class="metric">
            <span class="muted">{{ $t('plan.metric.current_weight') }}</span>
            <strong>{{ snapshot.physical.weight != null ? snapshot.physical.weight + ' kg' : '—' }}</strong>
          </div>
        </div>

        <!-- BMI + healthy-weight range -->
        <div v-if="bmi" class="bmi card">
          <div class="bmi-main">
            <span class="muted">{{ $t('plan.bmi.title') }}</span>
            <strong>{{ bmi.value }}</strong>
            <span class="bmi-cat" :class="bmi.category">{{ $t('plan.bmi.cat.' + bmi.category) }}</span>
          </div>
          <span class="muted">{{ $t('plan.bmi.ideal', { min: bmi.idealMin, max: bmi.idealMax }) }}</span>
        </div>

        <!-- Weight log + trend -->
        <section class="card">
          <strong class="sec-h">{{ $t('plan.weight.heading') }}</strong>
          <div class="weight-row">
            <input
              v-model="weightInput"
              class="num weight-input"
              type="number"
              min="1"
              max="500"
              step="0.1"
              :placeholder="$t('plan.weight.placeholder')"
              @keyup.enter="logWeight"
            />
            <button class="log-w-btn" :disabled="loggingWeight || !(Number(weightInput) > 0)" @click="logWeight">
              <i class="fa-solid" :class="loggingWeight ? 'fa-spinner fa-spin' : 'fa-plus'" /> {{ $t('plan.weight.log') }}
            </button>
          </div>
          <p v-if="weightFlash" class="ok">{{ weightFlash }}</p>
          <template v-if="weightSummary && weightSummary.current != null">
            <div class="weight-trend">
              <strong>{{ weightSummary.current }} kg</strong>
              <span v-if="weightSummary.trend != null && weightSummary.chart.length > 1" class="trend">
                <i class="fa-solid" :class="trendIcon" /> {{ Math.abs(weightSummary.trend) }} kg
              </span>
            </div>
            <svg v-if="sparkPoints" class="spark" :viewBox="`0 0 ${SPARK_W} ${SPARK_H}`" preserveAspectRatio="none" aria-hidden="true">
              <polyline :points="sparkPoints" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" />
            </svg>
          </template>
        </section>

        <!-- Inputs -->
        <section class="card">
          <strong class="sec-h">{{ $t('plan.inputs.heading') }}</strong>
          <div class="mode-seg" role="group">
            <button
              v-for="m in GOAL_MODES"
              :key="m.key"
              type="button"
              class="mode-pill"
              :class="{ on: form.goal_mode === m.key }"
              :aria-pressed="form.goal_mode === m.key"
              @click="form.goal_mode = m.key"
            >
              <i class="fa-solid" :class="m.icon" />
              <span>{{ $t('plan.mode.' + m.key) }}</span>
            </button>
          </div>

          <label class="fld" for="plan-activity">{{ $t('plan.field.activity_level') }}</label>
          <select id="plan-activity" v-model="form.activity_level" class="sel">
            <option v-for="a in ACTIVITY_LEVELS" :key="a" :value="a">{{ $t('plan.activity.' + a) }}</option>
          </select>

          <template v-if="!isMaintain">
            <label class="fld">
              {{ $t('plan.field.weekly_rate') }}
              <span class="muted">· {{ $t('plan.field.weekly_rate_unit', { n: Number(form.weekly_rate).toFixed(2) }) }}</span>
            </label>
            <input class="range" type="range" min="0" max="1.5" step="0.05" v-model.number="form.weekly_rate" />

            <label class="fld" for="plan-target">
              {{ $t('plan.field.target_weight') }} <span class="muted">{{ $t('plan.field.target_weight_hint') }}</span>
            </label>
            <input id="plan-target" v-model="form.target_weight" class="num" type="number" min="0" max="500" step="0.1" placeholder="kg" />
          </template>
        </section>

        <!-- Recommendation -->
        <section v-if="plan" class="card">
          <strong class="sec-h">{{ $t('plan.recommendation.heading') }}</strong>
          <div class="rec-goal">
            <span class="muted">{{ $t('plan.rec_goal') }}</span>
            <strong>{{ plan.calorie_goal }}</strong>
            <small class="muted">{{ $t('plan.metric.kcal_day') }}</small>
          </div>
          <div class="stats">
            <div class="stat"><span class="muted">{{ $t('plan.stat.bmr') }}</span><strong>{{ plan.bmr }}</strong></div>
            <div class="stat"><span class="muted">{{ $t('plan.stat.tdee') }}</span><strong>{{ plan.tdee }}</strong></div>
            <div class="stat"><span class="muted">{{ $t(adjustmentLabelKey) }}</span><strong>{{ Math.abs(plan.daily_adjustment) }}</strong></div>
          </div>
          <div class="macro-strip">
            <div><span class="muted">{{ $t('dashboard.macros.protein') }}</span><strong>{{ plan.macros.protein }}g</strong></div>
            <div><span class="muted">{{ $t('dashboard.macros.carbs') }}</span><strong>{{ plan.macros.carbs }}g</strong></div>
            <div><span class="muted">{{ $t('dashboard.macros.fat') }}</span><strong>{{ plan.macros.fat }}g</strong></div>
          </div>
          <p v-if="targetEta && targetEta.valid" class="eta">
            <i class="fa-solid fa-calendar-check" /> {{ $t('plan.eta', { date: etaDateLabel, weeks: targetEta.weeks }) }}
          </p>
          <button class="apply-btn" :disabled="applying" @click="applyPlan">
            <i class="fa-solid" :class="applying ? 'fa-spinner fa-spin' : 'fa-circle-check'" /> {{ $t('plan.apply_goal') }}
          </button>
          <p v-if="flash" class="ok">{{ flash }}</p>
          <p v-if="error" class="error">{{ error }}</p>
        </section>

        <!-- Macro split editor: sets the current goal's stored P/C/F goals -->
        <section v-if="snapshot.current_goal" class="card">
          <strong class="sec-h">{{ $t('plan.macros.heading') }}</strong>
          <div class="macro-edit">
            <div class="mfield">
              <label>{{ $t('dashboard.macros.protein') }} %</label>
              <input v-model.number="macroPct.protein" class="num" type="number" min="0" max="100" />
              <small class="muted">{{ macroGoalGrams.protein }}g</small>
            </div>
            <div class="mfield">
              <label>{{ $t('dashboard.macros.fat') }} %</label>
              <input v-model.number="macroPct.fat" class="num" type="number" min="0" max="100" />
              <small class="muted">{{ macroGoalGrams.fat }}g</small>
            </div>
            <div class="mfield">
              <label>{{ $t('dashboard.macros.carbs') }} %</label>
              <input :value="macroGoalGrams.carbsPct" class="num" type="number" disabled />
              <small class="muted">{{ macroGoalGrams.carbs }}g</small>
            </div>
          </div>
          <p v-if="macroGoalGrams.warn" class="macro-warn">{{ $t('plan.macros.' + macroGoalGrams.warn) }}</p>
          <button class="apply-btn" :disabled="applyingMacros || !macroGoalGrams.valid" @click="applyMacros">
            <i class="fa-solid" :class="applyingMacros ? 'fa-spinner fa-spin' : 'fa-sliders'" /> {{ $t('plan.macros.save') }}
          </button>
          <p v-if="macroFlash" class="ok">{{ macroFlash }}</p>
          <p v-if="macroError" class="error">{{ macroError }}</p>
        </section>

        <!-- 7-day intake vs plan -->
        <section class="card">
          <strong class="sec-h">{{ $t('plan.recent.heading') }}</strong>
          <div v-if="snapshot.intake_summary.logged_days" class="chart">
            <div class="goal-line" :style="{ bottom: (goalLineValue / chartMax) * 80 + 'px' }" :title="goalLineValue + ' ' + $t('common.kcal')" />
            <div v-for="(d, i) in snapshot.intake_summary.daily" :key="i" class="chart-col">
              <div class="chart-bar" :style="{ height: Math.round((d.calories / chartMax) * 80) + 'px' }" :title="d.calories + ' ' + $t('common.kcal')" />
              <small class="muted">{{ d.label }}</small>
            </div>
          </div>
          <p v-else class="muted">{{ $t('plan.recent.empty') }}</p>
        </section>

        <!-- Coach notes + weekly budget -->
        <section class="card">
          <strong class="sec-h">{{ $t('plan.notes.heading') }}</strong>
          <div v-if="notes.length" class="notes">
            <p v-for="(n, i) in notes" :key="i" class="note">
              <i class="fa-solid fa-circle-info" /> <span>{{ $t('plan.note.' + n.code, n.params || {}) }}</span>
            </p>
          </div>
          <p v-else class="muted note-empty">{{ $t('plan.notes.empty') }}</p>
          <div class="weekly">
            <span class="muted">{{ $t('plan.weekly_budget') }}</span>
            <strong>{{ plan ? plan.weekly_target : '—' }}</strong>
            <small class="muted">{{ $t('plan.weekly_budget_unit') }}</small>
          </div>
        </section>
      </template>
    </div>
    <UnlockToast />
  </div>
</template>

<style scoped>
.plan-panel { height: 100%; overflow-y: auto; }
.plan-scroll { max-width: 600px; margin: 0 auto; padding: 4px 16px 24px; }
.muted { color: var(--muted); font-size: 13px; }
.center { text-align: center; }
.pad { padding: 14px; }
.error { color: #f87171; margin: 8px 0 0; font-size: 13px; }
.ok { color: var(--accent); margin: 8px 0 0; font-size: 13px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px; margin-bottom: 12px; }
.sec-h { display: block; margin-bottom: 12px; }

/* Needs-metrics empty state */
.plan-empty { text-align: center; }
.plan-empty i { font-size: 22px; color: var(--muted); }
.plan-empty strong { display: block; margin: 10px 0 4px; }
.link-btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
  margin-top: 12px; padding: 0 18px; border-radius: 10px;
  background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 14px; text-decoration: none;
}

/* Hero metrics strip */
.metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.metric {
  background: var(--card); border: 1px solid var(--border); border-radius: 12px;
  padding: 10px 8px; display: flex; flex-direction: column; gap: 4px; text-align: center;
}
.metric strong { font-size: 14px; }
.metric .muted { font-size: 11px; }

/* BMI block */
.bmi { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }
.bmi-main { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.bmi-main > strong { font-size: 20px; }
.bmi-cat { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
.bmi-cat.normal { color: var(--accent); }
.bmi-cat.underweight, .bmi-cat.overweight { color: #fb923c; }
.bmi-cat.obese { color: #f87171; }

/* Weight log + trend sparkline */
.weight-row { display: flex; gap: 8px; }
.weight-input { flex: 1; min-width: 0; }
.log-w-btn { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; }
.weight-trend { display: flex; align-items: baseline; gap: 10px; margin-top: 12px; }
.weight-trend > strong { font-size: 22px; }
.weight-trend .trend { font-size: 13px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.spark { display: block; width: 100%; height: 44px; margin-top: 8px; }

/* Macro split editor */
.macro-edit { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.mfield { display: flex; flex-direction: column; gap: 4px; }
.mfield label { font-size: 12px; color: var(--muted); }
.mfield .num { text-align: center; }
.mfield small { text-align: center; }
.macro-warn { margin: 8px 0 0; font-size: 13px; color: #fb923c; }

/* Goal-mode segmented control */
.mode-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.mode-pill {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  min-height: 56px; padding: 8px 4px; border-radius: 12px;
  background: var(--inset); color: var(--muted); border: 1px solid var(--border); font-weight: 600; font-size: 13px;
}
.mode-pill i { font-size: 15px; }
.mode-pill.on { color: var(--accent); border-color: var(--accent); }

/* Fields */
.fld { display: block; margin: 14px 0 6px; font-size: 13px; color: var(--muted); }
.sel, .num { width: 100%; }
.range { width: 100%; height: 28px; accent-color: var(--accent); cursor: pointer; }

/* Recommendation */
.rec-goal { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0 12px; }
.rec-goal strong { font-size: 32px; line-height: 1; color: var(--accent); }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.stat {
  background: var(--inset); border: 1px solid var(--border); border-radius: 10px;
  padding: 8px; display: flex; flex-direction: column; gap: 3px; text-align: center;
}
.stat .muted { font-size: 11px; }
.stat strong { font-size: 15px; }
.macro-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
.macro-strip > div {
  background: var(--inset); border: 1px solid var(--border); border-radius: 10px;
  padding: 8px; display: flex; flex-direction: column; gap: 3px; text-align: center; font-size: 13px;
}
.macro-strip .muted { font-size: 11px; }
.eta { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; font-size: 13px; color: var(--muted); }
.apply-btn {
  width: 100%; margin-top: 14px; min-height: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
}

/* 7-day chart with goal line */
.chart { position: relative; display: flex; align-items: flex-end; gap: 8px; height: 100px; margin-top: 4px; }
.chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; justify-content: flex-end; }
.chart-bar { width: 100%; background: var(--accent); border-radius: 4px 4px 0 0; min-height: 2px; transition: height 0.3s; }
.goal-line {
  position: absolute; left: 0; right: 0; height: 0;
  border-top: 1px dashed var(--muted); pointer-events: none;
}

/* Notes + weekly budget */
.notes { display: flex; flex-direction: column; gap: 8px; }
.note { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 13px; }
.note i { color: var(--muted); margin-top: 2px; }
.note-empty { margin: 0; }
.weekly {
  display: flex; align-items: baseline; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border);
}
.weekly strong { font-size: 18px; }
</style>
