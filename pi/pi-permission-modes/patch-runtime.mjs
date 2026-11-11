import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

// The pinned runtime omits the version probe used by macOS command startup.
const target = new URL("./node_modules/@anthropic-ai/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js", import.meta.url);
const source = readFileSync(target, "utf8");
const rule = '        \'  (sysctl-name "kern.iossupportversion")\',\n';
const anchor = '        \'  (sysctl-name "kern.osproductversion")\',\n';
if (!source.includes(rule)) {
    assert.equal(source.split(anchor).length, 2, "Runtime sysctl rules changed. Review the macOS compatibility patch.");
    const patched = source.replace(anchor, rule + anchor);
    assert.equal(patched.replace(rule, ""), source, "Only the version-probe rule may change.");
    writeFileSync(target, patched);
}
assert.equal(readFileSync(target, "utf8").split(rule).length, 2, "Expected exactly one version-probe rule.");
