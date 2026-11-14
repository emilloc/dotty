import { readFile, readdir, mkdir, rename, writeFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_STATE_CHARS = 12000;
export const DEFAULTS = Object.freeze({ checkpointAt: 0.60, enforceAt: 0.75, refreshTools: 8, refreshTokens: 8000, maxContinuations: 8, maxStalledContinuations: 2 });

export async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

// A trusted launcher can keep checkpoints outside model-writable project files.
export function stateDirectory(cwd) {
  const override = process.env.PI_TASK_STATE_DIR;
  if (!override) return join(cwd, ".pi", "task-state");
  if (!isAbsolute(override)) throw new Error("PI_TASK_STATE_DIR must be an absolute path.");
  return override;
}

export function taskPath(cwd, taskId) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(taskId)) throw new Error("Task ID must be 1–80 lowercase letters, digits, hyphens or underscores.");
  return join(stateDirectory(cwd), taskId + ".json");
}

export function validateState(state) {
  for (const key of ["objective", "nextAction"]) {
    if (typeof state[key] !== "string" || !state[key].trim()) throw new Error(key + " must be a non-empty string.");
  }
  if (!["active", "blocked", "complete"].includes(state.status)) throw new Error("Invalid task status.");
  for (const key of ["completed", "decisions", "failedApproaches", "unresolved"]) {
    if (!Array.isArray(state[key]) || state[key].some(item => typeof item !== "string")) throw new Error(key + " must be an array of strings.");
  }
  if (JSON.stringify(state).length > MAX_STATE_CHARS) throw new Error("Checkpoint exceeds 12,000 characters. Condense existing state rather than appending a diary.");
}

const LISTS = ["completed", "decisions", "failedApproaches", "unresolved"];
const clip = (text, max) => text.length > max ? text.slice(0, max - 14) + " …[truncated]" : text;

// Local models send partial updates and overshoot length limits. Rejecting those
// costs a full model turn, so omitted fields keep their saved value and long
// values are shortened. `notes` tells the model what was changed.
export function mergeCheckpoint(previous, params) {
  const notes = [];
  const text = (key) => {
    const value = params[key] ?? previous?.[key];
    if (typeof value === "string" && value.length > 1000) notes.push(key + " truncated to 1000 characters");
    return typeof value === "string" ? clip(value, 1000) : value;
  };
  const state = { objective: text("objective"), status: params.status ?? previous?.status ?? "active" };
  for (const key of LISTS) {
    const items = params[key] ?? previous?.[key] ?? [];
    if (items.some(item => item.length > 500)) notes.push(key + " items truncated to 500 characters");
    if (items.length > 20) notes.push(key + " kept its last 20 items");
    state[key] = items.slice(-20).map(item => clip(item, 500));
  }
  state.nextAction = text("nextAction");
  let dropped = 0;
  while (JSON.stringify(state).length > MAX_STATE_CHARS - 200 && state.completed.length > 1) { state.completed.shift(); dropped++; }
  if (dropped) notes.push(dropped + " oldest completed items dropped to fit 12,000 characters; record lasting evidence in the research file");
  return { state, notes };
}

export async function readState(path) {
  const state = await readJson(path);
  if (state) {
    validateState(state);
    if (state.version !== 1 || !Number.isInteger(state.revision) || state.revision < 1) throw new Error("Invalid checkpoint format: " + path);
  }
  return state;
}

export async function listActiveStates(cwd) {
  const directory = stateDirectory(cwd);
  let files;
  try { files = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const active = [];
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!file.isFile() || !/^[a-z0-9][a-z0-9_-]{0,79}\.json$/.test(file.name)) continue;
    const state = await readState(join(directory, file.name));
    if (state?.status === "active") active.push({ taskId: file.name.slice(0, -5), state });
  }
  return active;
}

export async function saveState(path, state, expectedRevision) {
  validateState(state);
  await mkdir(join(path, ".."), { recursive: true });
  const lock = path + ".lock";
  try { await mkdir(lock); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Checkpoint is locked by another writer. Retry later; remove the lock only after verifying no writer is active."); throw error; }
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    const previous = await readState(path);
    if ((previous?.revision ?? 0) !== expectedRevision) throw new Error("Checkpoint changed in another session. Call state_select to reload it before saving.");
    const saved = { ...state, version: 1, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    validateState(saved);
    await writeFile(temp, JSON.stringify(saved, null, 2) + "\n", { mode: 0o600 });
    await rename(temp, path);
    return saved;
  } finally { await rm(temp, { force: true }); await rm(lock, { recursive: true, force: true }); }
}

export async function budgetFor(ctx, agentDir) {
  const global = await readJson(join(agentDir, "settings.json"), {});
  const local = await readJson(join(ctx.cwd, ".pi", "settings.json"), {});
  const config = { ...DEFAULTS, ...global.piState, ...global.piTaskCheckpoint, ...local.piState, ...local.piTaskCheckpoint };
  for (const key of ["checkpointAt", "enforceAt"]) if (!(config[key] > 0 && config[key] < 1)) throw new Error("piTaskCheckpoint." + key + " must be between 0 and 1.");
  if (config.checkpointAt >= config.enforceAt) throw new Error("checkpointAt must be lower than enforceAt.");
  for (const key of ["refreshTools", "refreshTokens"]) if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error("piTaskCheckpoint." + key + " must be a positive integer.");
  for (const key of ["maxContinuations", "maxStalledContinuations"]) if (!Number.isInteger(config[key]) || config[key] < 0) throw new Error("piTaskCheckpoint." + key + " must be a non-negative integer.");
  const compaction = { ...global.compaction, ...local.compaction };
  const modelKey = ctx.model ? ctx.model.provider + "/" + ctx.model.id : "";
  const overrides = { ...global.compaction?.modelOverrides?.[modelKey], ...local.compaction?.modelOverrides?.[modelKey] };
  const reserve = config.reserveTokens ?? overrides.reserveTokens ?? compaction.reserveTokens ?? 16384;
  const usage = ctx.getContextUsage();
  const window = config.contextWindow ?? usage?.contextWindow ?? ctx.model?.contextWindow;
  if (!Number.isInteger(reserve) || reserve < 0) throw new Error("reserveTokens must be a non-negative integer.");
  if (window != null && (!Number.isInteger(window) || window <= reserve)) throw new Error("contextWindow must be greater than reserveTokens.");
  const tokens = Number.isFinite(usage?.tokens) && usage.tokens >= 0 ? usage.tokens : null;
  const limit = window ? window - reserve : null;
  const ratio = tokens !== null && limit ? tokens / limit : null;
  return { ...config, tokens, window: window ?? null, reserve, limit, remaining: tokens !== null && limit ? Math.max(0, limit - tokens) : null, ratio, autoCompaction: compaction.enabled !== false };
}

export function checkpointDue(budget, checkpoint, toolCount) {
  return budget.ratio !== null && budget.ratio >= budget.enforceAt &&
    (!checkpoint || toolCount - checkpoint.toolCount >= budget.refreshTools ||
      (checkpoint.tokens !== null && budget.tokens - checkpoint.tokens >= budget.refreshTokens));
}

export function formatBudget(budget) {
  const n = value => value === null ? "unknown" : value.toLocaleString("en-US");
  const used = "Context used: " + (budget.tokens === null ? "unknown (do not assume empty)" : n(budget.tokens) + " tokens");
  if (!budget.autoCompaction) return [used,
    "Automatic compaction is off. Checkpoint before the context reaches " + n(budget.limit) + " tokens, then ask the user to run /compact."].join("\n");
  // Local models read every number here as a hard limit, so the text says what compaction does.
  return [used,
    "Pi compacts the context automatically at " + n(budget.limit) + " tokens. Tokens until that compaction: " + n(budget.remaining) + ".",
    "Compaction is routine. It is not a limit on your work and it does not end the task. After it, your saved checkpoint is given back to you and you continue.",
    "The tokens until compaction do not restrict what you may start. If a step needs more tokens than remain, checkpoint and start it anyway."].join("\n");
}
