import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	activeBinaryView,
	BINARY_NINJA_PREFIX,
	normalizeBinaryNinjaTool,
	selectBoundTarget,
	validateBoundArguments,
} from "./guard.ts";

const ENTRY_TYPE = "pi-binja-guard.binding";
const OPEN_ITEMS = `${BINARY_NINJA_PREFIX}bn_open_item_list`;
const LIST_VIEWS = `${BINARY_NINJA_PREFIX}bn_binary_view_list`;
const SET_ACTIVE = `${BINARY_NINJA_PREFIX}bn_binary_view_set_active`;
const GET_ACTIVE = `${BINARY_NINJA_PREFIX}bn_binary_view_get_active`;

interface StoredBinding {
	version: 1;
	path: string | null;
}

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function restoreBinding(ctx: ExtensionContext): string | undefined {
	let path: string | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const data = entry.data as Partial<StoredBinding> | undefined;
		if (data?.version === 1) path = typeof data.path === "string" ? data.path : undefined;
	}
	return path;
}

function updateStatus(ctx: ExtensionContext, path: string | undefined): void {
	ctx.ui.setStatus("pi-binja-guard", path ? `Binja bound: ${path}` : undefined);
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

export default function binjaGuard(pi: ExtensionAPI): void {
	let bindingPath: string | undefined;
	const authorizedParents = new Set<string>();

	pi.on("session_start", (_event, ctx) => {
		bindingPath = restoreBinding(ctx);
		updateStatus(ctx, bindingPath);
	});

	pi.on("session_tree", (_event, ctx) => {
		bindingPath = restoreBinding(ctx);
		updateStatus(ctx, bindingPath);
	});

	pi.on("session_shutdown", () => {
		authorizedParents.clear();
	});

	pi.registerCommand("binja-bind", {
		description: "Bind Binary Ninja MCP calls to one open local file. Use 'off' to clear it.",
		handler: async (rawPath, ctx) => {
			const requested = stripOuterQuotes(rawPath.trim());
			if (!requested) {
				ctx.ui.notify(bindingPath ? `Binary Ninja target: ${bindingPath}` : "Binary Ninja target is not bound", "info");
				return;
			}
			if (requested === "off") {
				bindingPath = undefined;
				pi.appendEntry<StoredBinding>(ENTRY_TYPE, { version: 1, path: null });
				updateStatus(ctx, bindingPath);
				ctx.ui.notify("Binary Ninja target binding cleared", "info");
				return;
			}

			try {
				const path = realpathSync(resolve(ctx.cwd, requested));
				if (!statSync(path).isFile()) throw new Error("the target is not a regular file");
				bindingPath = path;
				pi.appendEntry<StoredBinding>(ENTRY_TYPE, { version: 1, path });
				updateStatus(ctx, bindingPath);
				ctx.ui.notify(`Binary Ninja target bound to ${path}`, "info");
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
		name: "binja_call",
		label: "Binary Ninja bound call",
		description:
			"Call one Binary Ninja MCP tool after selecting and verifying the operator-bound file. Use a short bn_* tool name or its full mcp__binaryninja__* name. Inspect Binary Ninja schemas with tool_search or codemode describeNamespace before calling this tool.",
		promptSnippet: "Call Binary Ninja tools through binja_call after the operator runs /binja-bind <path>.",
		promptGuidelines: [
			"Use binja_call for every Binary Ninja operation. Never call mcp__binaryninja__ tools directly.",
			"If binja_call reports no binding, ask the operator to run /binja-bind with the exact local target path.",
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
			const expectedPath = bindingPath;
			if (!expectedPath) throw new Error("No Binary Ninja target is bound. Run /binja-bind <absolute-path> first.");

			const targetTool = normalizeBinaryNinjaTool(params.tool);
			authorizedParents.add(toolCallId);
			try {
				const openItems = await nestedCall(ctx, OPEN_ITEMS, { offset: 0, limit: 1000 }, signal);
				const binaryViews = await nestedCall(ctx, LIST_VIEWS, { offset: 0, limit: 1000 }, signal);
				const target = selectBoundTarget(resultText(openItems.result), resultText(binaryViews.result), expectedPath);
				const args = validateBoundArguments(params.arguments ?? {}, target);

				await nestedCall(ctx, SET_ACTIVE, { binaryView: target.binaryView }, signal);
				const active = await nestedCall(ctx, GET_ACTIVE, {}, signal);
				const activeView = activeBinaryView(resultText(active.result), active.result.structuredContent);
				if (activeView !== target.binaryView) {
					throw new Error(
						`Binary Ninja active view readback was ${String(activeView)}, expected ${target.binaryView}`,
					);
				}

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
