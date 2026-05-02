// automation.mjs – At & Cron scheduling with due detection,
// one-shot completion, and recurring next-run calculation.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, 'automation-state.json');

// ── Schedule types ────────────────────────────────────────────────
export function createAtSchedule(options) {
  // options.runAt: ISO 8601 datetime string
  // options.task: description
  // options.id: optional unique id (defaults to "at-" + timestamp)
  const { runAt, task, id } = options;
  const runAtMs = new Date(runAt).getTime();
  if (isNaN(runAtMs)) throw new Error(`Invalid runAt date: ${runAt}`);
  return {
    id: id || `at-${Date.now()}`,
    kind: 'at',
    task,
    runAt: runAt.toISOString ? runAt : new Date(runAt).toISOString(),
    runAtMs,
    completed: false,
    createdAt: new Date().toISOString(),
  };
}

export function createCronSchedule(options) {
  // options.expression: cron expression like "*/5 * * * *"
  // options.task: description
  // options.id: optional unique id
  // options.timezone: optional (default UTC)
  const { expression, task, id, timezone } = options;
  validateCronExpression(expression);
  const now = Date.now();
  const nextRunMs = nextCronRun(expression, now, timezone);
  return {
    id: id || `cron-${Date.now()}`,
    kind: 'cron',
    task,
    expression,
    timezone: timezone || 'UTC',
    lastRunMs: null,
    nextRunMs,
    createdAt: new Date().toISOString(),
  };
}

// ── Cron expression parser (simplified 5-field: min hour dom mon dow) ──
function validateCronExpression(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron expression must have 5 fields, got ${parts.length}: "${expr}"`);
  // Basic validation: each field should match cron syntax
  const cronFieldRe = /^(\*|\d+(-\d+)?(\/\d+)?)(,\d+(-\d+)?(\/\d+)?)*$/;
  for (const [i, part] of parts.entries()) {
    if (part !== '*' && !cronFieldRe.test(part)) {
      throw new Error(`Invalid cron field #${i} ("${part}") in expression "${expr}"`);
    }
  }
}

function fieldMatches(value, field) {
  // field: a cron field like "*", "5", "1-5", "*/10", "1,3,5"
  if (field === '*') return true;
  const values = field.split(',');
  for (const v of values) {
    if (v.includes('/')) {
      const [range, stepStr] = v.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step < 1) continue;
      const start = range === '*' ? 0 : parseInt(range, 10);
      if (isNaN(start)) continue;
      if ((value - start) % step === 0) return true;
    } else if (v.includes('-')) {
      const [lo, hi] = v.split('-').map(Number);
      if (!isNaN(lo) && !isNaN(hi) && value >= lo && value <= hi) return true;
    } else {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n === value) return true;
    }
  }
  return false;
}

function nextCronRun(expression, afterMs, timezone) {
  // Find the next datetime matching the cron expression after afterMs
  // Uses UTC for calculation, advancing minute by minute (efficient for near-term)
  const base = new Date(afterMs);
  // Start from the next whole minute
  base.setUTCSeconds(0, 0);
  base.setUTCMinutes(base.getUTCMinutes() + 1);
  const parts = expression.trim().split(/\s+/);
  const [cronMin, cronHour, cronDom, cronMon, cronDow] = parts;

  const MAX_ITERATIONS = 525600; // 1 year of minutes
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const d = new Date(base.getTime() + i * 60000);
    if (!fieldMatches(d.getUTCMonth() + 1, cronMon)) continue;
    if (!fieldMatches(d.getUTCDate(), cronDom)) continue;
    if (!fieldMatches(d.getUTCDay(), cronDow)) continue;
    if (!fieldMatches(d.getUTCHours(), cronHour)) continue;
    if (!fieldMatches(d.getUTCMinutes(), cronMin)) continue;
    return d.getTime();
  }
  throw new Error(`Could not find next cron match for "${expression}" within range`);
}

// ── Due detection ─────────────────────────────────────────────────
export function isDue(schedule, nowMs = Date.now()) {
  if (schedule.kind === 'at') {
    return !schedule.completed && nowMs >= schedule.runAtMs;
  }
  if (schedule.kind === 'cron') {
    return schedule.nextRunMs !== null && nowMs >= schedule.nextRunMs;
  }
  return false;
}

// ── One-shot completion ───────────────────────────────────────────
export function completeOneShot(schedule) {
  if (schedule.kind !== 'at') {
    throw new Error(`completeOneShot is only for 'at' schedules, got '${schedule.kind}'`);
  }
  schedule.completed = true;
  schedule.completedAt = new Date().toISOString();
  return schedule;
}

// ── Recurring next-run calculation ────────────────────────────────
export function advanceRecurring(schedule, nowMs = Date.now()) {
  if (schedule.kind !== 'cron') {
    throw new Error(`advanceRecurring is only for 'cron' schedules, got '${schedule.kind}'`);
  }
  schedule.lastRunMs = nowMs;
  schedule.nextRunMs = nextCronRun(schedule.expression, nowMs, schedule.timezone);
  schedule.updatedAt = new Date().toISOString();
  return schedule;
}

// ── Persistence helpers ───────────────────────────────────────────
export function saveSchedule(schedule) {
  let state = [];
  if (existsSync(STATE_PATH)) {
    try { state = JSON.parse(readFileSync(STATE_PATH, 'utf-8')); } catch { state = []; }
  }
  const idx = state.findIndex(s => s.id === schedule.id);
  if (idx >= 0) state[idx] = schedule;
  else state.push(schedule);
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  return schedule;
}

export function loadSchedules() {
  if (!existsSync(STATE_PATH)) return [];
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf-8')); } catch { return []; }
}

export function resetState() {
  if (existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, '[]', 'utf-8');
  }
}
