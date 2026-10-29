import assert from "node:assert/strict";
import test from "node:test";
import {
	activeBinaryView,
	normalizeBinaryNinjaTool,
	selectBoundTarget,
	validateBoundArguments,
} from "../guard.ts";

const openItems = `---
tool: "bn_open_item_list"
---

| openItem | kind | displayName | path |
| --- | --- | --- | --- |
| item_1 | file | ls | /usr/bin/ls |
| item_2 | file | pipe | /tmp/a\\|b.bin |
`;

const views = `---
tool: "bn_binary_view_list"
---

| binaryView | openItem | viewType | created | active | available | recommended |
| --- | --- | --- | --- | --- | --- | --- |
| view_1 | item_1 | ELF | true | false | true | true |
| view_2 | item_1 | Raw | true | false | true | false |
| view_3 | item_2 | Raw | true | false | true | true |
`;

test("selects the exact open item and its recommended view", () => {
	assert.deepEqual(selectBoundTarget(openItems, views, "/usr/bin/ls"), {
		path: "/usr/bin/ls",
		openItem: "item_1",
		binaryView: "view_1",
		viewType: "ELF",
	});
	assert.equal(selectBoundTarget(openItems, views, "/tmp/a|b.bin").openItem, "item_2");
});

test("fails closed when the bound path or recommended view is ambiguous", () => {
	assert.throws(() => selectBoundTarget(openItems, views, "/missing"), /found 0/);
	assert.throws(
		() => selectBoundTarget(openItems, views.replace("| view_2 | item_1 | Raw | true | false | true | false |", "| view_2 | item_1 | Raw | true | false | true | true |"), "/usr/bin/ls"),
		/found 2/,
	);
});

test("accepts target tools but reserves view and file control tools", () => {
	assert.equal(normalizeBinaryNinjaTool("bn_function_list"), "mcp__binaryninja__bn_function_list");
	assert.equal(
		normalizeBinaryNinjaTool("mcp__binaryninja__bn_binary_view_info"),
		"mcp__binaryninja__bn_binary_view_info",
	);
	assert.throws(() => normalizeBinaryNinjaTool("bn_open_item_open"), /reserved/);
	assert.throws(() => normalizeBinaryNinjaTool("mcp__other__bn_function_list"), /Invalid/);
});

test("rejects handles outside the selected target", () => {
	const target = selectBoundTarget(openItems, views, "/usr/bin/ls");
	assert.deepEqual(validateBoundArguments({ binaryView: "view_1", limit: 10 }, target), {
		binaryView: "view_1",
		limit: 10,
	});
	assert.throws(() => validateBoundArguments({ binaryView: "view_3" }, target), /bound view is view_1/);
	assert.throws(() => validateBoundArguments({ openItem: "item_2" }, target), /bound item is item_1/);
	assert.throws(() => validateBoundArguments([], target), /must be an object/);
});

test("reads the active view from structured content or MCP JSON text", () => {
	assert.equal(activeBinaryView('{"binaryView":"view_1"}', undefined), "view_1");
	assert.equal(activeBinaryView("ignored", { binaryView: "view_2" }), "view_2");
	assert.equal(activeBinaryView('{"binaryView":"view_3"}', {}), "view_3");
	assert.equal(activeBinaryView('{"binaryView":{"handle":"view_4"}}', undefined), "view_4");
	assert.equal(
		activeBinaryView("ignored", { structuredContent: { binaryView: { handle: "view_5" } } }),
		"view_5",
	);
	assert.equal(activeBinaryView('{"binaryView":null}', undefined), null);
	assert.throws(() => activeBinaryView("{}", undefined), /omitted binaryView/);
});
