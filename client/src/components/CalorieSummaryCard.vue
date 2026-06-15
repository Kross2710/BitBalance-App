<script setup>
// Shared calories + macros summary card. Used on both the Dashboard and the
// Intake page so the running total looks identical and stays in one place.
// Fed by either the dashboard `day` payload or intake's `daily_summary` — both
// carry total_calories, calorie_goal, progress_percentage, macros, macro_goals.
// overlimit + remaining/over are derived here (neither payload needs to send a
// status_class/focus block). macro_coverage (how many of today's entries carry
// macros) is sent only by intake's daily_summary, so the "fill missing macros"
// nudge shows on Intake — where you can act on it — and is silently absent on the
// Dashboard (a reflection surface).
import { computed } from 'vue';

const props = defineProps({
  summary: { type: Object, required: true },
});

const total = computed(() => Number(props.summary.total_calories) || 0);
const goal = computed(() => {
  const g = props.summary.calorie_goal;
  return g != null && Number(g) > 0 ? Number(g) : null;
});
const hasGoal = computed(() => goal.value != null);
const progress = computed(() => (props.summary.progress_percentage ?? 0) + '%');
const overlimit = computed(() => goal.value != null && total.value > goal.value);
const remaining = computed(() => (goal.value != null ? Math.max(0, goal.value - total.value) : null));
const overBy = computed(() => (goal.value != null ? Math.max(0, total.value - goal.value) : null));
const macros = computed(() => props.summary.macros || { protein: 0, carbs: 0, fat: 0 });
const macroGoals = computed(() => props.summary.macro_goals || { protein: 0, carbs: 0, fat: 0 });

// Per-macro bar data. Protein is a FLOOR — hitting or exceeding the goal is good,
// so it never flags an "over" state. Carbs and fat are BUDGETS — exceeding flags
// a warning. This is why a single "over = red" rule across all three would be
// wrong: it would paint hitting your protein target as a failure.
function bar(current, goalVal, kind) {
  const c = Number(current) || 0;
  const g = Number(goalVal) || 0;
  const pct = g > 0 ? Math.min(100, Math.round((c / g) * 100)) : 0;
  return { current: c, goal: g, width: pct + '%', over: kind === 'budget' && g > 0 && c > g };
}
const macroBars = computed(() => [
  { key: 'protein', ...bar(macros.value.protein, macroGoals.value.protein, 'floor') },
  { key: 'carbs', ...bar(macros.value.carbs, macroGoals.value.carbs, 'budget') },
  { key: 'fat', ...bar(macros.value.fat, macroGoals.value.fat, 'budget') },
]);

// Macro logging coverage (intake only). Surface the nudge only when some of
// today's entries are missing macros (logged < total) — that is exactly when the
// AI-fill button is worth a tap. Hidden when every entry has macros or none exist.
const coverage = computed(() => props.summary.macro_coverage || null);
const showCoverage = computed(() => {
  const c = coverage.value;
  return !!c && Number(c.total) > 0 && Number(c.logged) < Number(c.total);
});
</script>

<template>
  <section class="card calorie-summary">
    <div class="cs-head">
      <strong>{{ $t('dashboard.summary.calories') }}</strong>
      <span class="muted">{{ total }} / {{ goal ?? '—' }} {{ $t('common.kcal') }}</span>
    </div>
    <div class="bar"><div :style="{ width: progress, background: overlimit ? '#f87171' : 'var(--accent)' }" /></div>

    <!-- Macros: a label + a thin (4px) progress bar per macro. Protein bar stays
         accent even when full (a floor met = good); carbs/fat turn red over budget. -->
    <div class="cs-macros">
      <div v-for="m in macroBars" :key="m.key" class="cs-macro" :class="{ over: m.over }">
        <span class="cs-macro-label muted">
          {{ $t('intake.macro_abbr.' + m.key) }} {{ m.current }}<template v-if="hasGoal"> / {{ m.goal }}</template>g
        </span>
        <div v-if="hasGoal" class="cs-macro-bar"><div :style="{ width: m.width }" /></div>
      </div>
    </div>

    <p v-if="showCoverage" class="muted cs-coverage">
      <i class="fa-solid fa-circle-info" />
      {{ $t('dashboard.summary.macro_coverage', { logged: coverage.logged, total: coverage.total }) }}
    </p>

    <p v-if="hasGoal" class="muted cs-focus">
      <template v-if="!overlimit">{{ $t('dashboard.focus.title.left', { n: remaining }) }}</template>
      <template v-else>{{ $t('dashboard.focus.title.over', { n: overBy }) }}</template>
    </p>
  </section>
</template>

<style scoped>
.muted { color: var(--muted); font-size: 13px; }
.cs-head { display: flex; justify-content: space-between; }
.bar { height: 10px; background: var(--inset); border-radius: 6px; margin-top: 10px; overflow: hidden; }
.bar > div { height: 100%; transition: width 0.3s; }

/* Three macro columns, each a label + a thin progress bar. The bars are kept
   deliberately thin so they add a glanceable signal without competing with the
   calorie bar above. */
.cs-macros { display: flex; gap: 16px; margin-top: 12px; }
.cs-macro { flex: 1; min-width: 0; }
.cs-macro-label { display: block; font-size: 13px; white-space: nowrap; }
.cs-macro-bar { height: 4px; background: var(--inset); border-radius: 3px; margin-top: 5px; overflow: hidden; }
.cs-macro-bar > div { height: 100%; width: 0; background: var(--accent); transition: width 0.3s; }
/* Budget macros (carbs/fat) over goal read as a warning; protein (a floor) never does. */
.cs-macro.over .cs-macro-bar > div { background: #f87171; }
.cs-macro.over .cs-macro-label { color: #f87171; }

.cs-coverage { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; font-size: 12px; }
.cs-focus { margin: 10px 0 0; font-size: 13px; }
</style>
