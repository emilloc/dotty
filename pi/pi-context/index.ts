// Keeps a local model's context small: bounded tool output, and a `delegate` tool that
// moves large reading jobs into a child Pi process with its own context. It also starts
// each session on the model the local inference server has loaded.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Starting values, not measured optimums. Tune them against the session journals.
export const READ_LINES = 400;
export const BASH_CHARS = 12_000;
export const ANSWER_CHARS = 8_000;
const OUTPUT_DIR = "/tmp/pi/output"; // /tmp/pi is writable and readable inside the shell sandbox

/** Keeps the first and last half of an over-long text and says where the rest went. */
export function capText(text: string, max: number, savedTo: string): string {
	if (text.length <= max) return text;
	const half = max / 2;
	const omitted = text.length - max;
	return `${text.slice(0, half)}\n\n[${omitted} characters omitted. Full output: ${savedTo}. Search it with grep or read a range.]\n\n${text.slice(-half)}`;
}

const CHILD_BRIEF =
	"You are a delegated reader with your own context. The caller sees only your final message, not the files you read. " +
	"Do the task, then answer in under 600 words: findings first, each with a file:line or offset anchor, then what you did not check. " +
	"Do not edit files.\n\nTask: ";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		// Pi's own paging then tells the model how to read the next range.
		if (event.toolName === "read" && event.input.limit == null) event.input.limit = READ_LINES;
	});

	pi.on("tool_result", (event) => {
		if (event.toolName !== "bash") return;
		const text = event.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
		if (text.length <= BASH_CHARS) return;
		// Above 50KB Pi has already saved the complete output. Point at that file when it exists.
		let savedTo = (event.details as { fullOutputPath?: string } | undefined)?.fullOutputPath;
		if (!savedTo) {
			savedTo = join(OUTPUT_DIR, `${event.toolCallId.replace(/[^\w.-]/g, "_")}.txt`);
			mkdirSync(OUTPUT_DIR, { recursive: true });
			writeFileSync(savedTo, text, { mode: 0o600 });
		}
		return { content: [{ type: "text" as const, text: capText(text, BASH_CHARS, savedTo) }] };
	});

	// A child must not delegate again, and it already runs on its parent's model.
	if (process.env.PI_DELEGATE_CHILD) return;

	// A local server serves one model at a time. When the session's model is not the loaded
	// one, switch to it. Only providers from models.json are asked, and an explicit --model
	// or --provider is left alone.
	pi.on("session_start", async (_event, ctx) => {
		const model = ctx.model;
		if (!model || process.argv.some((arg) => /^(-m|--model|--provider)(=|$)/.test(arg))) return;
		try {
			const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
			const provider = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")).providers?.[model.provider];
			if (!provider?.baseUrl) return;
			const response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(3000) });
			const served = (await response.json()).data;
			if (!Array.isArray(served) || served.length !== 1 || served[0].id === model.id) return;
			const loaded = ctx.modelRegistry.find(model.provider, served[0].id);
			if (loaded && (await pi.setModel(loaded)) && ctx.hasUI) ctx.ui.notify(`Model: ${model.provider}/${loaded.id} is the one loaded on the server`, "info");
			else if (!loaded && ctx.hasUI) ctx.ui.notify(`The server has ${served[0].id} loaded, which is not in models.json`, "warning");
		} catch {
			if (ctx.hasUI) ctx.ui.notify(`Could not reach the ${model.provider} server to check the loaded model`, "warning");
		}
	});

	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description:
			"Hand one self-contained reading or search task to a fresh Pi session with its own context. Returns only its final answer. " +
			"The child knows nothing from this conversation, so name the files, the question and what to report.",
		promptSnippet: "Delegate a large reading or search job to a fresh context.",
		promptGuidelines: [
			"Use delegate when answering needs reading several files or one large file and you only need the conclusion. Read directly when you know the exact range you need.",
		],
		// Plain JSON Schema, so the file also loads outside Pi for its unit test.
		parameters: {
			type: "object",
			properties: { task: { type: "string", description: "The complete task, including paths and what to report" } },
			required: ["task"],
		} as any,
		async execute(_id, params, signal, _update, ctx) {
			const args = ["--mode", "json", "-p", "--no-session"];
			if (ctx.model) args.push("--model", `${ctx.model.provider}/${ctx.model.id}`);
			// A Blind parent keeps its child offline. Otherwise the child takes the permission
			// extension's headless fallback: the read-only sandbox, without the planning prompt.
			const env: NodeJS.ProcessEnv = { ...process.env, PI_DELEGATE_CHILD: "1" };
			if (env.PI_PERMISSION_MODE === "blind") args.push("--perm", "blind");
			delete env.PI_PERMISSION_MODE;
			args.push(CHILD_BRIEF + params.task);

			const script = process.argv[1];
			const [command, commandArgs] = script && existsSync(script) ? [process.execPath, [script, ...args]] : ["pi", args];
			const child = spawn(command, commandArgs, { cwd: ctx.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
			const kill = () => child.kill("SIGTERM");
			signal?.addEventListener("abort", kill, { once: true });

			let buffer = "";
			let stderr = "";
			let answer = "";
			let turns = 0;
			let contextTokens = 0;
			const onLine = (line: string) => {
				let event: any;
				try { event = JSON.parse(line); } catch { return; }
				if (event.type !== "message_end" || event.message?.role !== "assistant") return;
				turns++;
				contextTokens = event.message.usage?.totalTokens ?? contextTokens;
				const text = event.message.content.flatMap((part: any) => (part.type === "text" ? [part.text] : [])).join("\n").trim();
				if (text) answer = text;
			};
			child.stdout.on("data", (data) => {
				const lines = (buffer + data).split("\n");
				buffer = lines.pop() ?? "";
				lines.forEach(onLine);
			});
			child.stderr.on("data", (data) => { stderr += data; });
			const code = await new Promise<number>((resolve) => {
				child.on("close", (exit) => resolve(exit ?? 1));
				child.on("error", (error) => { stderr += String(error); resolve(1); });
			});
			signal?.removeEventListener("abort", kill);
			if (buffer) onLine(buffer);
			if (signal?.aborted) throw new Error("Delegated task was aborted.");
			if (code !== 0 || !answer) throw new Error(`Delegated task failed (exit ${code}): ${stderr.trim().slice(-600) || "no answer returned"}`);

			const text = answer.length > ANSWER_CHARS ? `${answer.slice(0, ANSWER_CHARS)}\n[answer truncated at ${ANSWER_CHARS} characters]` : answer;
			return { content: [{ type: "text", text }], details: { turns, contextTokens } };
		},
	});
}
