import assert from "node:assert/strict";
import test from "node:test";
import { mergeCheckpoint, validateState } from "../core.js";

const saved = { objective: "Trace the parser", status: "active", completed: ["a"], decisions: ["d"], failedApproaches: [], unresolved: ["u"], nextAction: "read x", version: 1, revision: 3 };

test("omitted fields keep their saved value", () => {
  const { state, notes } = mergeCheckpoint(saved, { completed: ["a", "b"], nextAction: "read y" });
  assert.deepEqual(state, { objective: "Trace the parser", status: "active", completed: ["a", "b"], decisions: ["d"], failedApproaches: [], unresolved: ["u"], nextAction: "read y" });
  assert.deepEqual(notes, []);
  validateState(state);
});

test("long values are shortened and reported, not rejected", () => {
  const { state, notes } = mergeCheckpoint(saved, { completed: ["x".repeat(700)], decisions: Array.from({ length: 25 }, (_, i) => "d" + i) });
  assert.ok(state.completed[0].length <= 500 && state.completed[0].endsWith("[truncated]"));
  assert.equal(state.decisions.length, 20);
  assert.equal(state.decisions.at(-1), "d24");
  assert.equal(notes.length, 2);
  validateState(state);
});

test("an oversized state drops its oldest completed items", () => {
  const { state, notes } = mergeCheckpoint(saved, { completed: Array.from({ length: 20 }, (_, i) => i + "y".repeat(498)), decisions: Array.from({ length: 20 }, () => "z".repeat(500)) });
  assert.ok(state.completed.length < 20 && state.completed.at(-1).startsWith("19"));
  assert.match(notes.at(-1), /oldest completed items dropped/);
  validateState({ ...state, version: 1, revision: 4, updatedAt: new Date().toISOString() });
});

test("a first checkpoint without an objective still fails clearly", () => {
  assert.throws(() => validateState(mergeCheckpoint(null, { nextAction: "start" }).state), /objective must be a non-empty string/);
});
