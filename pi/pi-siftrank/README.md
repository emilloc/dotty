# Local SiftRank integration

The design is a Pi skill plus the unchanged, pinned SiftRank CLI and a Python
standard-library launcher. No dedicated Pi tool, adapter, dependency, or service
is needed. Bash already provides permission enforcement and cancellation.

## Install on a device

Requires Python 3.8 or newer, Go 1.24 or newer, the existing Pi permission extension, and an
existing device-local forward to the inference service. From the dotty checkout:

```sh
python3 pi/pi-siftrank/setup.py --model qwen3.8-flash-next --port 18888
```

Setup installs the pinned Go module under `~/.local/share/pi-siftrank`, seeds the
checksum-verified tokenizer cache, creates the explicit profile at
`~/.config/siftrank/pi-local.json`, and links the skill into `~/.pi/agent/skills`.
It adds only `localhost:18888` to the existing Default, Plan, and Build shell
allowlists, preserving other settings and saving the original permission file.
It also adds only this skill directory to those modes' `sandbox.insideRoots`.
This prevents the extension's outside-project gate from offering an unsandboxed
run, including ordinary inspection of the skill's files. It does not grant
filesystem writes. Invoke `python3` from PATH, since an
absolute interpreter path can itself trigger that gate. The launcher requires
the local proxy and refuses ordinary unsandboxed execution.
An existing different profile or skill is not overwritten. Rerunning the same
setup is supported. Nothing changes Pi's model registry or starts a server.

Installation may download Go modules and a public tokenizer file. Ranking makes
no tokenizer download and clears provider environment overrides. No inference
credential is copied from Pi. This integration requires the existing forwarded
service to accept requests without authentication, as the tested service does.

The same config and install paths apply on macOS and Linux. `localhost.` forces
Go through Pi's HTTP proxy rather than its special loopback bypass. The runtime
matches the exact `localhost:PORT` grant. Do not use `/net allow` for this grant:
the current command normalizes away the port. Linux additionally needs its usual
working bubblewrap setup and the device's existing inference forward.

## Contract and checks

- Explicit local endpoint and model, with no implicit config or provider fallback.
- Concurrency 1, bounded trials and process deadline, inherited Pi cancellation.
- Preflight model match and completion-model evidence.
- Complete candidate coverage, unchanged records, unique indices/keys, finite
  ascending scores (lower is better), positive exposure, and completed trace before publication.
- Useful top candidates in repeated real rankings, with measurements and artifacts.
- Bad profiles, missing cache, unavailable backends, and blocked modes fail visibly.

Run deterministic checks with:

```sh
python3 -m unittest discover -s pi/pi-siftrank -p 'test_*.py'
```

`--tokens 16000` controls estimated batch input, not output tokens. The pinned CLI
can retry network errors internally. The launcher reports logged successful calls
and reported tokens, not a complete count or price of all server-side attempts.
The fixed presentation includes only ID, source, and text, while retaining other
metadata verbatim. Split oversized records before ranking. Ranks across separate
collections are not directly comparable.

## Integration choice

A skill keeps enumeration and relevance criteria in Pi, while the CLI reads the
collection from disk. Only a short result enters conversational context. A new
dedicated tool would use the same ranker, model, and network boundary, so it would
not improve ranking quality or inference latency. Add one only if real sessions
repeatedly fail to invoke this documented command correctly. Do not move execution
outside the sandbox to fix invocation trouble.

Ranking model time and tokens are recorded per run. Pi's time and tokens spent
preparing or invoking the command are separate, and are not included in those
figures. Server contention can increase latency or cause the stock 15-second
request timeout. The process deadline is an operational failure bound, not a
research stopping rule.
