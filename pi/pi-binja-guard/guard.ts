export const BINARY_NINJA_PREFIX = "mcp__binaryninja__";

const CONTROL_TOOLS = new Set([
	"bn_binary_view_get_active",
	"bn_binary_view_list",
	"bn_binary_view_set_active",
	"bn_open_item_close",
	"bn_open_item_list",
	"bn_open_item_open",
	"bn_project_file_list",
	"bn_project_file_open",
]);

export interface BoundTarget {
	path: string;
	openItem: string;
	binaryView: string;
	viewType: string;
}

function splitTableRow(line: string): string[] {
	let body = line.trim();
	if (body.startsWith("|")) body = body.slice(1);
	if (body.endsWith("|")) body = body.slice(0, -1);

	const cells: string[] = [];
	let cell = "";
	for (let index = 0; index < body.length; index += 1) {
		const character = body[index];
		if (character === "\\" && body[index + 1] === "|") {
			cell += "|";
			index += 1;
		} else if (character === "|") {
			cells.push(cell.trim());
			cell = "";
		} else {
			cell += character;
		}
	}
	cells.push(cell.trim());
	return cells;
}

function parseTable(text: string, requiredHeaders: string[]): Record<string, string>[] {
	const lines = text.split(/\r?\n/);
	const headerIndex = lines.findIndex((line) => {
		if (!line.trim().startsWith("|")) return false;
		const headers = splitTableRow(line);
		return requiredHeaders.every((header) => headers.includes(header));
	});
	if (headerIndex < 0 || headerIndex + 1 >= lines.length) {
		throw new Error(`Binary Ninja response omitted table columns: ${requiredHeaders.join(", ")}`);
	}

	const headers = splitTableRow(lines[headerIndex]);
	const separator = splitTableRow(lines[headerIndex + 1]);
	if (separator.length !== headers.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
		throw new Error("Binary Ninja returned a malformed Markdown table");
	}

	const rows: Record<string, string>[] = [];
	for (const line of lines.slice(headerIndex + 2)) {
		if (!line.trim().startsWith("|")) break;
		const values = splitTableRow(line);
		if (values.length !== headers.length) {
			throw new Error("Binary Ninja returned a Markdown row with the wrong number of columns");
		}
		rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index]])));
	}
	return rows;
}

export function selectBoundTarget(openItemsText: string, binaryViewsText: string, expectedPath: string): BoundTarget {
	const openItems = parseTable(openItemsText, ["openItem", "path"]);
	const matchingItems = openItems.filter((item) => item.path === expectedPath);
	if (matchingItems.length !== 1) {
		const knownPaths = openItems
			.map((item) => item.path)
			.filter(Boolean)
			.slice(0, 5)
			.join(", ");
		throw new Error(
			`Expected one open Binary Ninja item at ${expectedPath}, found ${matchingItems.length}. Open paths: ${knownPaths || "none"}`,
		);
	}

	const openItem = matchingItems[0].openItem;
	const views = parseTable(binaryViewsText, [
		"binaryView",
		"openItem",
		"viewType",
		"available",
		"recommended",
	]);
	const recommended = views.filter(
		(view) => view.openItem === openItem && view.available === "true" && view.recommended === "true",
	);
	if (recommended.length !== 1) {
		throw new Error(
			`Expected one recommended BinaryView for ${expectedPath}, found ${recommended.length}. Select a single recommended view in Binary Ninja.`,
		);
	}

	return {
		path: expectedPath,
		openItem,
		binaryView: recommended[0].binaryView,
		viewType: recommended[0].viewType,
	};
}

export function normalizeBinaryNinjaTool(tool: string): string {
	const shortName = tool.startsWith(BINARY_NINJA_PREFIX) ? tool.slice(BINARY_NINJA_PREFIX.length) : tool;
	if (!/^bn_[a-z0-9_]+$/.test(shortName)) {
		throw new Error(`Invalid Binary Ninja tool name: ${tool}`);
	}
	if (CONTROL_TOOLS.has(shortName)) {
		throw new Error(`${shortName} is reserved for the binding guard`);
	}
	return `${BINARY_NINJA_PREFIX}${shortName}`;
}

export function validateBoundArguments(args: unknown, target: BoundTarget): Record<string, unknown> {
	if (args === null || typeof args !== "object" || Array.isArray(args)) {
		throw new Error("Binary Ninja tool arguments must be an object");
	}
	const input = args as Record<string, unknown>;
	if (Object.hasOwn(input, "openItem") && input.openItem !== target.openItem) {
		throw new Error(`Tool requested openItem ${String(input.openItem)}, but the bound item is ${target.openItem}`);
	}
	if (Object.hasOwn(input, "binaryView") && input.binaryView !== target.binaryView) {
		throw new Error(`Tool requested binaryView ${String(input.binaryView)}, but the bound view is ${target.binaryView}`);
	}
	return input;
}

export function activeBinaryView(text: string, structured: unknown): string | null {
	function handle(value: unknown): string | null | undefined {
		if (value === null || typeof value === "string") return value;
		if (typeof value !== "object") return undefined;
		if (Object.hasOwn(value, "handle")) return handle((value as { handle?: unknown }).handle);
		if (Object.hasOwn(value, "binaryView")) return handle((value as { binaryView?: unknown }).binaryView);
		if (Object.hasOwn(value, "structuredContent")) {
			return handle((value as { structuredContent?: unknown }).structuredContent);
		}
		return undefined;
	}

	const structuredValue = handle(structured);
	const value = structuredValue === undefined ? handle(JSON.parse(text)) : structuredValue;
	if (value === null || typeof value === "string") return value;
	throw new Error("Binary Ninja active-view response omitted binaryView");
}
