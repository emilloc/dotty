const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

test("briefing captures inputs, isolates Pi, and cleans up after success or failure", (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-brief-test-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const agentDir = path.join(dir, "agent");
    const stateFile = path.join(dir, "task state.json");
    const researchFile = path.join(dir, "research notes.md");
    const log = path.join(dir, "call.json");
    const originalState = JSON.stringify({ objective: "Assess a synthetic appliance", revision: 3, updatedAt: "2026-11-05T08:47:48Z" });
    const originalResearch = "# Research\nNo vulnerability is confirmed.\n";
    fs.mkdirSync(path.join(agentDir, "bin"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "bin", "pi"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.BRIEF_TEST_RESEARCH, "Changed after capture");
const files = args.filter(arg => arg.startsWith("@")).map(arg => arg.slice(1));
fs.writeFileSync(process.env.BRIEF_TEST_LOG, JSON.stringify({args, files, cwd: process.cwd(), contents: files.map(file => fs.readFileSync(file, "utf8"))}));
process.exit(Number(process.env.BRIEF_TEST_STATUS || 0));
`, { mode: 0o700 });
    const run = (status = "0") => spawnSync(process.execPath, [path.join(__dirname, "..", "pi-brief"), stateFile, researchFile], {
        encoding: "utf8",
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, BRIEF_TEST_RESEARCH: researchFile, BRIEF_TEST_LOG: log, BRIEF_TEST_STATUS: status },
    });
    for (const status of ["0", "7"]) {
        fs.writeFileSync(stateFile, originalState);
        fs.writeFileSync(researchFile, originalResearch);
        const result = run(status);
        assert.equal(result.status, Number(status), result.stderr);
        const call = JSON.parse(fs.readFileSync(log, "utf8"));
        assert.deepEqual(call.contents, [originalState, originalResearch]);
        assert.equal(path.basename(call.cwd), path.basename(path.dirname(call.files[0])));
        assert.notEqual(call.cwd, process.cwd());
        assert.equal(fs.readFileSync(stateFile, "utf8"), originalState);
        for (const flag of ["--offline", "--no-tools", "--no-extensions", "--no-mcp", "--no-skills", "--no-context-files", "--no-prompt-templates"]) {
            assert.ok(call.args.includes(flag), flag);
        }
        assert.equal(call.args[call.args.indexOf("--session-dir") + 1], path.join(agentDir, "sessions", "briefings"));
        assert.ok(!call.args.includes("--continue"));
        assert.ok(!call.args.includes("--no-session"));
        assert.match(call.args.at(-1), /"revision": 3/);
        assert.match(call.args.at(-1), /"sha256": "[a-f0-9]{64}"/);
        assert.ok(call.files.every(file => !fs.existsSync(file)));
        fs.unlinkSync(log);
    }
    for (const invalid of ["{", "null", "{}", '{"objective":"x","revision":"3","updatedAt":"now"}']) {
        fs.writeFileSync(stateFile, invalid);
        assert.equal(run().status, 1);
        assert.ok(!fs.existsSync(log));
    }
    fs.writeFileSync(stateFile, originalState);
    fs.writeFileSync(researchFile, " \n");
    assert.equal(run().status, 1);
    assert.ok(!fs.existsSync(log));
    fs.unlinkSync(researchFile);
    assert.equal(run().status, 1);
    assert.ok(!fs.existsSync(log));
});
