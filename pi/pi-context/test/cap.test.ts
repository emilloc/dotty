import assert from "node:assert/strict";
import test from "node:test";
import { capText } from "../index.ts";

test("short text is unchanged", () => {
	assert.equal(capText("abc", 10, "/tmp/x"), "abc");
});

test("long text keeps both ends and names the saved file", () => {
	const out = capText("H".repeat(50) + "M".repeat(900) + "T".repeat(50), 100, "/tmp/pi/output/id.txt");
	assert.ok(out.startsWith("H".repeat(50)) && out.endsWith("T".repeat(50)));
	assert.match(out, /\[900 characters omitted\. Full output: \/tmp\/pi\/output\/id\.txt\./);
	assert.ok(!out.includes("MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM"));
});
