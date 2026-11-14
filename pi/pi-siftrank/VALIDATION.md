# Validation, 2026-11-12

Installed and usable in a new Pi session. The supported design is this skill,
the pinned stock CLI, and `rank.py` through Pi bash. No dedicated tool or service
was added. The launcher and skill are symlinked into the user's normal Pi setup.

## Current connection

Plain Pi 1.5.0 uses provider `spark`. Its configured URL is
`http://127.0.0.1:18888/v1`, forwarded to the existing Spark inference service.
The current `com.sparky.pipeline-inference` LaunchAgent runs `/usr/bin/ssh`
with `BatchMode=yes` and `-L 127.0.0.1:18888:127.0.0.1:8888`. A live SSH process
was confirmed listening on `127.0.0.1:18888`.
The current `/models` response identifies `qwen3.8-flash-next`, backed by
`nvidia/Qwen3.8-Flash-Next-FP4-Local`, with a 262,144-token context limit.
The Pi API credential is present. SiftRank does not copy or require it for this
endpoint, which accepts the tested unauthenticated requests.

SiftRank independently pins `http://localhost.:18888/v1`, the same Qwen model,
and `effort: none`. The dotted hostname makes Go use Pi's filtered HTTP proxy.
The pinned source sends Chat Completions with strict JSON-schema output. Live
rankings returned valid structured results and the expected completion model.
No Codex adapter, ChatGPT subscription, or cloud inference provider was used.

## Installed changes

- `~/.local/share/pi-siftrank`: pinned binary, installation manifest, tokenizer cache.
- `~/.config/siftrank/pi-local.json`: explicit secret-free ranking profile.
- `~/.pi/agent/skills/siftrank`: link to this directory.
- Default, Plan, and Build: exact `localhost:18888` network grant and this skill
  directory in `sandbox.insideRoots`. No additional filesystem write grants.
- Original permissions saved in
  `~/.pi/agent/permission-mode/permission-mode.before-siftrank.json`.

Blind, the custom offline research mode, top-level permission settings, Pi model
configuration, and the inference containers were left unchanged. Production
profile and binary manifest matched the isolated tested installation. Pi's
actual skill loader discovered one SiftRank skill without a collision.

## Evidence

The preserved artifact directory is:

`/private/var/folders/1f/f8fq4t854tn6zrfx4003_xzw0000gn/T/pi-siftrank-current-0azmcpl7`

It contains the original oversized fixture, prepared candidates, criteria,
expected relevance labels, exact commands, isolated profiles, native boundary
driver, real Pi RPC driver/events, outputs, logs, tests, and measurements.
Each accepted ranking also contains its presentation template, model discovery,
effective profile, CLI command, trace, raw process logs, and validated output.
The earlier November 10 pilot was preserved separately and not overwritten.

The 16-item corpus is frozen historical source, including the old `pi-web`
launcher. It tests ranking relevance, not whether those source excerpts still
describe today's setup. Four records are key evidence, several are secondary,
three are distractors, and an oversized source is retained with eight smaller
source-located records. The 24-item test adds eight labeled synthetic negatives.

| Test | Candidates / trials | Ranker seconds | Successful completions | Input / output tokens | Result |
|---|---:|---:|---:|---:|---|
| Native macOS Build | 16 / 2 | 20.001 | 2 | 29,058 / 208 | All key items in top five |
| Native macOS Plan repeat | 16 / 2 | 20.061 | 2 | 29,061 / 229 | All key items in top four |
| Native macOS, larger collection | 24 / 2 | 18.906 | 3 | 27,008 / 293 | All key items in top seven, one missing-ID correction |
| Real Pi/Qwen, final skill | 8 / 1 | 4.1 | 1 | 5,080 / 53 | Correct top four and saved deliverables |

All accepted runs retained every original record, with unique identities and
positive comparison exposure. The two 16-item repeats shared their top three.
Their full-order Spearman correlation was 0.953. The 24-item run demonstrates
that a trial is not a full all-pairs comparison or a fixed number of requests.
Its first malformed ranking was corrected by the CLI before publication.

The Build/Plan boundary driver uses the current real extension, real bash tool,
real filtered proxy, and native `sandbox-exec`, with simulated Pi UI/session
facades. The RPC trials use real Pi 1.5.0 and Qwen, with the current permission
extension and isolated configuration. They are not full production sessions
with every unrelated extension loaded.

The final real Pi interaction took 46.23 seconds, five assistant calls and five
tool calls. Pi reported 39,033 input and 1,462 output tokens, separate from the
ranking tokens above. Before the output contract was clarified, the same task
took 73.98 seconds and ten assistant/tool calls, with 96,540 input and 2,342
output tokens. These single runs are diagnostic, not a controlled speed
comparison. The configured price is zero, not a measurement of electricity,
hardware cost, or an independently reported dollar price.

## Failures and boundaries

Five deterministic tests cover invalid profiles, command/credential rejection,
oversized and duplicate inputs, identity/coverage/score checks, permission merge
preservation, deadline termination, and signal cancellation. Setup was exercised
in an isolated home, rerun, and checked for refusal to overwrite a different
profile. `git diff --check` passed.

Live negative checks confirmed missing-profile failure, wrong-model refusal,
403 for an unapproved local port, 502 for an allowed but absent backend, Blind
network denial, and Default direct-loopback denial. No fallback was authorized.

An early test driver mistakenly approved outside-project bash prompts. In the
current extension that approval executes unsandboxed, even though the prompt
does not say so explicitly. Those early rankings are retained as diagnostics
and excluded from the native boundary results above. The corrected driver
rejects all such prompts. The installed directory bound keeps skill inspection
and invocation sandboxed, and the launcher refuses a missing local proxy.
Read-only permission to load the skill is distinct from a bash escape.

Other development failures were an incorrect descending-score validator and
an empty-proxy handling bug. Both were corrected before the accepted tests.
The stock CLI itself was not patched. Native runs also emitted macOS network
denial notices while their proxy requests succeeded. The proxy grant did not
open direct loopback networking in Default/Plan.

## Decision and limits

The skill is sufficient for invoking the CLI and preserving useful results.
Explicit output-field instructions fixed the observed orchestration confusion.
A dedicated tool would still use the same backend, ranking algorithm, and
permission boundary. There is no measured quality advantage to adding it now.

Ranking remains advisory. Small repeats do not establish precision on arbitrary
research collections, and lower-order ranking varies. Do not use low rank as an
absence claim or an automatic reason to discard evidence.

Native Linux execution remains untested. Spark is Linux ARM64 and has bubblewrap,
but no Pi or Go installation was found. No extra tooling was installed there.
The launcher uses the same home-relative paths on both platforms, but a Linux
device still needs its normal Pi sandbox and its own inference forward.

Runs were serial. Shared-server contention was not controlled or benchmarked.
The stock CLI's 15-second request timeout and internal retries remain. The outer
deadline bounds the local process, not server work already accepted. Logged
successful completions and reported tokens do not count every possible HTTP
attempt. Large production collections and simultaneous Pi/ranking workloads are
the next useful tests, using real user packets rather than more synthetic cases.
