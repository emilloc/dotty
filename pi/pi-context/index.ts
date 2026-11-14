// Keeps a local model's context small: bounded tool output, and a `delegate` tool that
// moves large reading jobs into a child Pi process with its own context. It also starts
// each session on the model the local inference server has loaded.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Starting values, not measured optimums. Tune them against the session journals.
export const READ_LINES = 400;
export const BASH_CHARS = 12_000;
export const ANSWER_CHARS = 8_000;
const OUTPUT_DIR = "/tmp/pi/output"; // /tmp/pi is writable and readable inside the shell sandbox
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

/** Keeps the first and last half of an over-long text and says where the rest went. */
export function capText(text: string, max: number, savedTo: string): string {
	if (text.length <= max) return text;
	const half = max / 2;
	const omitted = text.length - max;
	return `${text.slice(0, half)}\n\n[${omitted} characters omitted. Full output: ${savedTo}. Search it with grep or read a range.]\n\n${text.slice(-half)}`;
}

function saveOutput(id: string, text: string): string {
	const path = join(OUTPUT_DIR, `${id.replace(/[^\w.-]/g, "_")}.txt`);
	mkdirSync(OUTPUT_DIR, { recursive: true });
	writeFileSync(path, text, { mode: 0o600 });
	return path;
}

export interface ChildState {
	/** The closing message of each agent run, in order. */
	answers: string[];
	turns: number;
	contextTokens: number;
	/** The child's latest tool call, for the progress line. */
	last: string;
}

/** Folds one line of the child's `--mode json` output into the state. */
export function readEvent(state: ChildState, line: string): void {
	let event: any;
	try { event = JSON.parse(line); } catch { return; }
	const message = event.message;
	if (event.type !== "message_end" || message?.role !== "assistant") return;
	state.turns++;
	state.contextTokens = message.usage?.totalTokens ?? state.contextTokens;
	const call = message.content.find((part: any) => part.type === "toolCall");
	if (call) state.last = `${call.name} ${JSON.stringify(call.arguments).slice(0, 80)}`;
	// A run closes with a message that calls no tool. A background command that finishes
	// later starts another run, so the last closing message can be a short acknowledgement
	// and not the report. Keep every closing message.
	const text = message.content.flatMap((part: any) => (part.type === "text" ? [part.text] : [])).join("\n").trim();
	if (text && !call) state.answers.push(text);
}

const CHILD_BRIEF =
	"You are a delegated worker with your own context. The caller sees only your final message, not your earlier messages or the files you read. " +
	"Do the task. Run any command that can take longer than one minute in the background and check on it, so that you stay reachable. " +
	"The user may send you a message while you work. Follow it, then continue the task. " +
	"Wait for every background command you started before you finish. Then send one final message and nothing after it: " +
	"findings first, each with a file:line or offset anchor, then the absolute path of every file you created, then what you did not check. " +
	"Keep it under 600 words. Do not modify files that already exist.\n\nTask: ";

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
		const savedTo = (event.details as { fullOutputPath?: string } | undefined)?.fullOutputPath ?? saveOutput(event.toolCallId, text);
		return { content: [{ type: "text" as const, text: capText(text, BASH_CHARS, savedTo) }] };
	});

	// A child must not delegate again, and it already runs on its parent's model.
	if (process.env.PI_DELEGATE_CHILD) {
		// The parent forwards what the user types during the delegation. Pi delivers it to the
		// model after the tool call that is running. The channel must not keep the child alive.
		process.on("message", (text) => pi.sendUserMessage(`Message from the user, sent while you work:\n${text}`, { deliverAs: "steer" }));
		process.channel?.unref();
		return;
	}

	// A delegation is one long tool call, so a steering message would wait in this session's
	// queue until the child exits. Pass it to the running children as well. It stays queued
	// here, so this session also reads it when the child returns.
	const children = new Map<ChildProcess, number>(); // messages forwarded to each child
	pi.on("input", (event, ctx) => {
		if (event.streamingBehavior !== "steer" || !children.size) return;
		for (const [child, sent] of children) if (child.connected && child.send(event.text)) children.set(child, sent + 1);
		if (ctx.hasUI) ctx.ui.notify("Sent to the delegated task. It reads the message after its current tool call.", "info");
	});

	// A local server serves one model at a time. When the session's model is not the loaded
	// one, switch to it. Only providers from models.json are asked, and an explicit --model
	// or --provider is left alone.
	pi.on("session_start", async (_event, ctx) => {
		const model = ctx.model;
		if (!model || process.argv.some((arg) => /^(-m|--model|--provider)(=|$)/.test(arg))) return;
		try {
			const provider = JSON.parse(readFileSync(join(AGENT_DIR, "models.json"), "utf8")).providers?.[model.provider];
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
			"Hand one self-contained task (reading, a search, or a discovery pass) to a fresh Pi session with its own context. Returns only its final report. " +
			"The child knows nothing from this conversation, so name the files, the question and what to report. It can run for many minutes. " +
			"The child runs in this session's permission mode. From Default and Plan it is read-only: it can write only Markdown notes in the project, and other files it creates go to its own scratch directory, which its report names.",
		promptSnippet: "Delegate a large reading, search or discovery job to a fresh context.",
		promptGuidelines: [
			"Use delegate when answering needs reading several files or one large file and you only need the conclusion. Read directly when you know the exact range you need.",
		],
		// Plain JSON Schema, so the file also loads outside Pi for its unit test.
		parameters: {
			type: "object",
			properties: { task: { type: "string", description: "The complete task, including paths and what to report" } },
			required: ["task"],
		} as any,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			// The child's journal is kept, so its work can be reviewed after it exits.
			const sessions = join(AGENT_DIR, "sessions", "delegated");
			const args = ["--mode", "json", "-p", "--session-dir", sessions];
			if (ctx.model) args.push("--model", `${ctx.model.provider}/${ctx.model.id}`);
			// The child gets the authority this session already has without asking the user, so it
			// runs in the same mode. Default asks before every command and Plan carries a planning
			// prompt, and a child can use neither. From those two it takes the permission
			// extension's headless fallback: the read-only sandbox.
			const env: NodeJS.ProcessEnv = { ...process.env, PI_DELEGATE_CHILD: "1" };
			const mode = env.PI_PERMISSION_MODE;
			if (mode && mode !== "default" && mode !== "plan") args.push("--perm", mode);
			delete env.PI_PERMISSION_MODE;
			args.push(CHILD_BRIEF + params.task);

			const script = process.argv[1];
			const [command, commandArgs] = script && existsSync(script) ? [process.execPath, [script, ...args]] : ["pi", args];
			const child = spawn(command, commandArgs, { cwd: ctx.cwd, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
			children.set(child, 0);
			const kill = () => child.kill("SIGTERM");
			signal?.addEventListener("abort", kill, { once: true });

			const state: ChildState = { answers: [], turns: 0, contextTokens: 0, last: "starting" };
			const details = () => ({ turns: state.turns, contextTokens: state.contextTokens });
			const size = () => `${Math.round(state.contextTokens / 1000)}K tokens`;
			const onLine = (line: string) => {
				const before = state.turns;
				readEvent(state, line);
				// Without this the caller sees nothing until the child exits, which can take an hour.
				if (state.turns !== before) onUpdate?.({ content: [{ type: "text", text: `Child turn ${state.turns}, ${size()}: ${state.last}` }], details: details() });
			};
			let buffer = "";
			let stderr = "";
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
			const forwarded = children.get(child) ?? 0;
			children.delete(child);
			if (buffer) onLine(buffer);
			if (signal?.aborted) throw new Error(`Delegated task was aborted after ${state.turns} turns. Its transcript is in ${sessions}.`);
			const report = state.answers.join("\n\n---\n\n");
			if (code !== 0 || !report) throw new Error(`Delegated task failed (exit ${code}): ${stderr.trim().slice(-600) || "no answer returned"}`);

			const text = report.length > ANSWER_CHARS ? capText(report, ANSWER_CHARS, saveOutput(`${toolCallId}-report`, report)) : report;
			return { content: [{ type: "text", text: `${text}\n\n[Child ran ${state.turns} turns and reached ${size()} of context. Transcript: ${sessions}]` +
				(forwarded ? `\n[The user sent ${forwarded} message(s) during this run. The child already received them.]` : "") }], details: details() };
		},
	});
}
