import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	activeBinaryView,
	BINARY_NINJA_PREFIX,
	normalizeBinaryNinjaTool,
	pathInsideDirectory,
	selectBoundTarget,
	validateBoundArguments,
} from "./guard.ts";

const ENTRY_TYPE = "pi-binja-guard.binding";
const OPEN_ITEM = `${BINARY_NINJA_PREFIX}bn_open_item_open`;
const OPEN_ITEMS = `${BINARY_NINJA_PREFIX}bn_open_item_list`;
const LIST_VIEWS = `${BINARY_NINJA_PREFIX}bn_binary_view_list`;
const SET_ACTIVE = `${BINARY_NINJA_PREFIX}bn_binary_view_set_active`;
const GET_ACTIVE = `${BINARY_NINJA_PREFIX}bn_binary_view_get_active`;

interface BindingState {
	mode: "file" | "directory";
	path: string;
	activePath?: string;
}

interface StoredBindingV1 {
	version: 1;
	path: string | null;
}

interface StoredBindingV2 {
	version: 2;
	mode: "file" | "directory";
	path: string | null;
	activePath?: string;
}

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function restoreBinding(ctx: ExtensionContext): BindingState | undefined {
	let binding: BindingState | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const data = entry.data as Partial<StoredBindingV1 & StoredBindingV2> | undefined;
		if (data?.version === 1) {
			binding = typeof data.path === "string" ? { mode: "file", path: data.path } : undefined;
		}
		if (data?.version === 2) {
			binding =
				typeof data.path === "string" && (data.mode === "file" || data.mode === "directory")
					? { mode: data.mode, path: data.path, activePath: data.activePath }
					: undefined;
		}
	}
	return binding;
}

function bindingLabel(binding: BindingState | undefined): string {
	if (!binding) return "Binary Ninja target is not bound";
	if (binding.mode === "file") return `Binary Ninja target: ${binding.path}`;
	return binding.activePath
		? `Binary Ninja scope: ${binding.path}\nActive target: ${binding.activePath}`
		: `Binary Ninja scope: ${binding.path}\nNo active scoped target`;
}

function updateStatus(ctx: ExtensionContext, binding: BindingState | undefined): void {
	const status = binding
		? binding.mode === "file"
			? `Binja bound: ${binding.path}`
			: `Binja scope: ${binding.path}${binding.activePath ? ` | ${binding.activePath}` : ""}`
		: undefined;
	ctx.ui.setStatus("pi-binja-guard", status);
}

function stripOuterQuotes(value: string): string {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
		return value.slice(1, -1);
	}
	return value;
}

async function nestedCall(ctx: ExtensionToolContext, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
	const outcome = await ctx.executeTool(name, args, { signal });
	if (outcome.isError || outcome.result.isError) {
		throw new Error(`${name} failed: ${resultText(outcome.result)}`);
	}
	return outcome;
}

function scopedFile(binding: BindingState | undefined, cwd: string, requested: string): string {
	if (!binding || binding.mode !== "directory") {
		throw new Error("No Binary Ninja directory scope is bound. Run /binja-bind <directory> first.");
	}
	const path = realpathSync(resolve(cwd, stripOuterQuotes(requested.trim())));
	if (!statSync(path).isFile()) throw new Error("the Binary Ninja target is not a regular file");
	if (!pathInsideDirectory(binding.path, path)) {
		throw new Error(`Binary Ninja target ${path} is outside the bound directory ${binding.path}`);
	}
	return path;
}

async function selectAndVerify(
	ctx: ExtensionToolContext,
	expectedPath: string,
	signal?: AbortSignal,
) {
	const openItems = await nestedCall(ctx, OPEN_ITEMS, { offset: 0, limit: 1000 }, signal);
	const binaryViews = await nestedCall(ctx, LIST_VIEWS, { offset: 0, limit: 1000 }, signal);
	const target = selectBoundTarget(resultText(openItems.result), resultText(binaryViews.result), expectedPath);

	await nestedCall(ctx, SET_ACTIVE, { binaryView: target.binaryView }, signal);
	const active = await nestedCall(ctx, GET_ACTIVE, {}, signal);
	const activeView = activeBinaryView(resultText(active.result), active.result.structuredContent);
	if (activeView !== target.binaryView) {
		throw new Error(`Binary Ninja active view readback was ${String(activeView)}, expected ${target.binaryView}`);
	}
	return target;
}

export default function binjaGuard(pi: ExtensionAPI): void {
	let binding: BindingState | undefined;
	const authorizedParents = new Set<string>();

	pi.on("session_start", (_event, ctx) => {
		binding = restoreBinding(ctx);
		updateStatus(ctx, binding);
	});

	pi.on("session_tree", (_event, ctx) => {
		binding = restoreBinding(ctx);
		updateStatus(ctx, binding);
	});

	pi.on("session_shutdown", () => {
		authorizedParents.clear();
	});

	pi.registerCommand("binja-bind", {
		description: "Bind Binary Ninja to one file or authorize files under one directory. Use 'off' to clear it.",
		handler: async (rawPath, ctx) => {
			const requested = stripOuterQuotes(rawPath.trim());
			if (!requested) {
				ctx.ui.notify(bindingLabel(binding), "info");
				return;
			}
			if (requested === "off") {
				binding = undefined;
				pi.appendEntry<StoredBindingV2>(ENTRY_TYPE, { version: 2, mode: "file", path: null });
				updateStatus(ctx, binding);
				ctx.ui.notify("Binary Ninja target binding cleared", "info");
				return;
			}

			try {
				const path = realpathSync(resolve(ctx.cwd, requested));
				const stat = statSync(path);
				if (!stat.isFile() && !stat.isDirectory()) throw new Error("the target is not a regular file or directory");
				binding = { mode: stat.isDirectory() ? "directory" : "file", path };
				pi.appendEntry<StoredBindingV2>(ENTRY_TYPE, { version: 2, ...binding });
				updateStatus(ctx, binding);
				ctx.ui.notify(bindingLabel(binding), "info");
			} catch (error) {
				ctx.ui.notify(`Cannot bind Binary Ninja target: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.on("tool_call", (event) => {
		if (!event.toolName.startsWith(BINARY_NINJA_PREFIX)) return;
		if (event.parentToolCallId && authorizedParents.has(event.parentToolCallId)) return;
		return {
			block: true,
			reason: "Direct Binary Ninja MCP calls are blocked. Bind a target with /binja-bind, then use binja_call.",
		};
	});

	pi.registerTool({
		name: "binja_open",
		label: "Open scoped Binary Ninja target",
		description:
			"Open a regular file inside the operator-bound directory, select its recommended BinaryView, and verify it is active.",
		promptSnippet: "Use binja_open to open a file after the operator runs /binja-bind <directory>.",
		promptGuidelines: [
			"Use binja_open only for files inside the operator-bound directory.",
			"Use binja_switch to return to another file that is already open.",
		],
		parameters: Type.Object(
			{ path: Type.String({ description: "Absolute path or cwd-relative path inside the bound directory." }) },
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		reachesTools: () => [OPEN_ITEM, OPEN_ITEMS, LIST_VIEWS, SET_ACTIVE, GET_ACTIVE],
		prepareLoadout: (loadout) => {
			const rawTools = loadout.declared.filter((tool) => tool.name.startsWith(BINARY_NINJA_PREFIX));
			return rawTools.length > 0 ? { hiddenDeclarations: rawTools.map((tool) => tool.name) } : undefined;
		},
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const path = scopedFile(binding, ctx.cwd, params.path);
			authorizedParents.add(toolCallId);
			try {
				const opened = await nestedCall(ctx, OPEN_ITEM, { path, kind: "file", setActive: false }, signal);
				const target = await selectAndVerify(ctx, path, signal);
				binding = { mode: "directory", path: binding!.path, activePath: path };
				pi.appendEntry<StoredBindingV2>(ENTRY_TYPE, { version: 2, ...binding });
				return {
					content: [
						{ type: "text", text: `Opened scoped target: ${path}\nBinaryView: ${target.binaryView} (${target.viewType})` },
						...opened.result.content,
					],
					details: { target, openResult: opened.result.details },
					isError: false,
				};
			} finally {
				authorizedParents.delete(toolCallId);
			}
		},
	});

	pi.registerTool({
		name: "binja_switch",
		label: "Switch scoped Binary Ninja target",
		description: "Select and verify an already-open Binary Ninja file inside the operator-bound directory.",
		promptSnippet: "Use binja_switch to move between already-open files in the bound directory.",
		promptGuidelines: ["Use binja_open when the requested file is not open yet."],
		parameters: Type.Object(
			{ path: Type.String({ description: "Absolute path or cwd-relative path inside the bound directory." }) },
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		reachesTools: () => [OPEN_ITEMS, LIST_VIEWS, SET_ACTIVE, GET_ACTIVE],
		prepareLoadout: (loadout) => {
			const rawTools = loadout.declared.filter((tool) => tool.name.startsWith(BINARY_NINJA_PREFIX));
			return rawTools.length > 0 ? { hiddenDeclarations: rawTools.map((tool) => tool.name) } : undefined;
		},
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const path = scopedFile(binding, ctx.cwd, params.path);
			authorizedParents.add(toolCallId);
			try {
				const target = await selectAndVerify(ctx, path, signal);
				binding = { mode: "directory", path: binding!.path, activePath: path };
				pi.appendEntry<StoredBindingV2>(ENTRY_TYPE, { version: 2, ...binding });
				return {
					content: [{ type: "text", text: `Active scoped target: ${path}\nBinaryView: ${target.binaryView} (${target.viewType})` }],
					details: { target },
					isError: false,
				};
			} finally {
				authorizedParents.delete(toolCallId);
			}
		},
	});

	pi.registerTool({
		name: "binja_call",
		label: "Binary Ninja bound call",
		description:
			"Call one Binary Ninja MCP tool after selecting and verifying the operator-bound file. Use a short bn_* tool name or its full mcp__binaryninja__* name. Inspect Binary Ninja schemas with tool_search or codemode describeNamespace before calling this tool.",
		promptSnippet:
			"Call Binary Ninja analysis tools through binja_call after binding one file or opening a file inside a bound directory.",
		promptGuidelines: [
			"Use binja_call for every Binary Ninja operation. Never call mcp__binaryninja__ tools directly.",
			"In file mode, ask the operator to open the exact file in Binary Ninja and run /binja-bind <file>.",
			"In directory mode, use binja_open and binja_switch to control the active target.",
		],
		parameters: Type.Object(
			{
				tool: Type.String({ description: "Binary Ninja tool name, such as bn_function_list." }),
				arguments: Type.Optional(
					Type.Record(Type.String(), Type.Unknown(), { description: "Arguments for the selected Binary Ninja tool." }),
				),
			},
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		reachesTools: (input) => {
			const requested = typeof input.tool === "string" ? input.tool : "";
			return [OPEN_ITEMS, LIST_VIEWS, SET_ACTIVE, GET_ACTIVE, requested];
		},
		prepareLoadout: (loadout) => {
			const rawTools = loadout.declared.filter((tool) => tool.name.startsWith(BINARY_NINJA_PREFIX));
			return rawTools.length > 0 ? { hiddenDeclarations: rawTools.map((tool) => tool.name) } : undefined;
		},
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!binding) throw new Error("No Binary Ninja target is bound. Run /binja-bind <file-or-directory> first.");
			const expectedPath = binding.mode === "file" ? binding.path : binding.activePath;
			if (!expectedPath) throw new Error("No scoped Binary Ninja target is active. Use binja_open first.");

			const targetTool = normalizeBinaryNinjaTool(params.tool);
			authorizedParents.add(toolCallId);
			try {
				const target = await selectAndVerify(ctx, expectedPath, signal);
				const args = validateBoundArguments(params.arguments ?? {}, target);

				const outcome = await ctx.executeTool(targetTool, args, { signal, onUpdate });
				return {
					...outcome.result,
					content: [
						{
							type: "text",
							text: `Bound target: ${target.path}\nBinaryView: ${target.binaryView} (${target.viewType})`,
						},
						...outcome.result.content,
					],
					details: {
						target,
						tool: targetTool,
						result: outcome.result.details,
					},
					isError: outcome.isError || outcome.result.isError,
				};
			} finally {
				authorizedParents.delete(toolCallId);
			}
		},
	});
}
