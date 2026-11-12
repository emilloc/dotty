import assert from "node:assert/strict";
import test from "node:test";
import { capText, readEvent } from "../index.ts";

test("short text is unchanged", () => {
	assert.equal(capText("abc", 10, "/tmp/x"), "abc");
});

test("long text keeps both ends and names the saved file", () => {
	const out = capText("H".repeat(50) + "M".repeat(900) + "T".repeat(50), 100, "/tmp/pi/output/id.txt");
	assert.ok(out.startsWith("H".repeat(50)) && out.endsWith("T".repeat(50)));
	assert.match(out, /\[900 characters omitted\. Full output: \/tmp\/pi\/output\/id\.txt\./);
	assert.ok(!out.includes("MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM"));
});

test("a report followed by a late acknowledgement keeps both, report first", () => {
	const state = { answers: [], turns: 0, contextTokens: 0, last: "starting" };
	const assistant = (content: unknown[], totalTokens: number) => JSON.stringify({ type: "message_end", message: { role: "assistant", content, usage: { totalTokens } } });
	readEvent(state, "not json");
	readEvent(state, JSON.stringify({ type: "message_end", message: { role: "user", content: [] } }));
	readEvent(state, assistant([{ type: "text", text: "Looking." }, { type: "toolCall", name: "bash", arguments: { command: "ls" } }], 900));
	readEvent(state, assistant([{ type: "thinking", thinking: "..." }, { type: "text", text: "THE REPORT" }], 1500));
	readEvent(state, assistant([{ type: "text", text: "That scan was already counted." }], 1600));
	assert.deepEqual(state.answers, ["THE REPORT", "That scan was already counted."]);
	assert.equal(state.turns, 3);
	assert.equal(state.contextTokens, 1600);
	assert.equal(state.last, 'bash {"command":"ls"}');
});
