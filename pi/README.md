# Pi research harness

This directory contains the portable Pi research setup for local models. After setup, plain `pi` is the whole harness. It does not change `dotty/install.sh`, Pi authentication, model providers, MCP servers, or session storage.

## Set up one device

Install Pi with the [official installer](https://pi.dev) first:

```sh
curl -fsSL https://pi.dev/install.sh | sh
```

The installer can install Node.js when needed. It creates a managed Pi installation and can migrate an existing npm installation. Update a managed installation with `pi update`.

Copy your private `models.json` and `settings.json` into `~/.pi/agent`. Keep them outside this public repository. On a device with existing Pi settings, back them up and merge the entries instead of replacing the files. Configure that device's SSH access and inference tunnel separately.

After cloning or pulling dotty, run:

```sh
~/dev/dotty/pi/setup
```

The setup requires Pi 1.4.0 or newer, Node.js 22.19 or newer, and npm. It installs the production dependencies pinned in the web-search and permission-mode lockfiles. Its first run needs internet access. It links the extensions into `~/.pi/agent/extensions`, then starts an ephemeral Pi session to verify web tools, permission modes, task checkpoints, delegation, and the Binary Ninja guard without sending a model request. Rerunning setup preserves model configuration and authentication.

Setup patches the pinned sandbox runtime to allow the macOS `kern.iossupportversion` read used during command startup. This prevents repeated sandbox denials without changing filesystem or network restrictions. The same patch runs on a normal permission-mode `npm install`.

## Start Pi

```sh
pi
```

Every session is the full research harness. Nothing needs to be run at session start.
Setup links four extensions into `~/.pi/agent/extensions`, which Pi loads in each session:

| Extension | What it gives you |
|---|---|
| `pi-permission-modes` 2.8.0-dotty.2 | Shell sandbox, permission modes and the network allowlist |
| `pi-web-search` | `search_web`, `read_url_content`, `find_text_in_url_content` |
| `pi-task-checkpoint` 0.1.1-dotty.1 | Durable task state under `.pi/task-state/` |
| `pi-context` | Bounded tool output, the `delegate` tool, and loaded-model selection |

`pi --no-extensions` starts a session without them.

Each session starts on the model your inference server has loaded. Pi asks the server of the default
provider in `models.json`, and switches when exactly one model is served and it differs from
`defaultModel`. Pass `--model` or `--provider` to choose yourself. The earlier `pi-web` launcher is
gone, because plain `pi` now does everything it did.

### Modes

Left Option+M (Alt+M on Linux) cycles modes. `/perm <mode>` or `pi --perm <mode>` selects one.

| Mode | Use it for |
|---|---|
| Default | Everyday work. Edits and commands ask first |
| Plan | Read-only investigation. Only Markdown can be written |
| Build | Hands-off work inside the project |
| Blind | Exercises where the model must not look up answers. No web tools and no shell network |
| Container | Docker, Podman and image builders. Daemons can act outside the sandbox |
| YOLO | No sandbox |

Default, Plan, Build and Blind block Unix sockets. Container mode permits all Unix
sockets on Linux because seccomp cannot filter them by path, and it permits the
standard Docker socket paths on macOS. It also permits nested user namespaces
for rootless Podman and Buildah.

### Context management

Local models work best with a context that stays small. Three things keep it small.

**Compaction and checkpoints.** Add this to `~/.pi/agent/settings.json`, with one entry for each
model you run. `reserveTokens` is the context window minus 150,000, so Pi compacts at 150,000 tokens.

```json
"compaction": {
  "modelOverrides": {
    "spark/qwen3.8-flash-next": { "reserveTokens": 112144, "keepRecentTokens": 30000 }
  }
},
"piTaskCheckpoint": { "checkpointAt": 0.70, "enforceAt": 0.85, "refreshTools": 16, "refreshTokens": 24000 }
```

The model is reminded to checkpoint at 105,000 tokens and must checkpoint at 127,500. Lower the
compaction point to 131,072 (`reserveTokens` 131072 for a 262,144 window) if long sessions drift.

A task starts with every session, so `/state` is optional. `/state <task-id>` resumes an earlier
task, and `/state off` turns checkpoints off for the session. The local copy of the checkpoint tool
accepts partial updates: fields the model omits keep their saved value, and over-long values are
shortened and reported.

**Bounded tool output.** A `read` without a `limit` returns 400 lines and says how to continue. A
`bash` result over 12,000 characters keeps its first and last 6,000 and names the file that holds
the full output. The values are constants at the top of `pi-context/index.ts`.

**Delegation.** The model can call `delegate` with one task description. A child `pi` with a fresh
context does the work, and only its final report returns. While the child runs, the tool call shows
its turn count, context size and latest command. Press Esc to stop it.

The child runs in the session's permission mode, so it can do what the session can already do
without asking you. Switch to Build before delegating work that produces files, such as an
extraction. From Default and Plan the child is read-only: it can read the project and write Markdown
notes there, and every other file it creates goes to its own scratch directory,
`/tmp/pi/<child-session-id>/`. Its report names those files by absolute path. Scratch directories
are removed after 7 days, and on Linux `/tmp` is often kept in memory, so move what you want to keep.

The child's journal is saved under `~/.pi/agent/sessions/delegated/`. Default and Plan ask once
before the first `delegate` call. Choose "allow forever" to stop the prompt.

`./journal-stats` prints context peaks, compactions, tool errors and result sizes from the session
journals. Run it after real research sessions to judge these values. `--since 2026-11-12` limits it
to newer sessions.

### Binary Ninja

Add the binding guard when the task needs it, then run `/binja-bind <path>`:

```sh
pi -e ~/dev/dotty/pi/pi-binja-guard
```

## Pi directories

Pi's default user directory is `~/.pi/agent`, singular. It owns the managed Pi executable, settings, models, authentication, MCP configuration, sessions, installed packages, and user extensions. This setup does not create `~/.pi/agents` or a second agent directory.

Setup prefers the managed `~/.pi/agent/bin/pi`. It uses a `pi` found on `PATH` only when the managed executable is absent. This prevents an older global npm installation from taking precedence.

The extension sources remain under `~/dev/dotty/pi`. Setup links them into `~/.pi/agent/extensions`, so a `git pull` updates every device without a reinstall.

## Sandbox defaults

Default and Plan disable local binding. On macOS this also blocks direct shell
connections to host loopback services. Build, Blind and Container retain local binding for
development servers. The Pi process's model connection is outside the shell sandbox and is
unchanged. Linux keeps its separate sandbox network namespace.

Sandboxed modes deny reads of common credential stores and `.env` / `.env.*`
files, including example files. Reads elsewhere remain denylist-based. Inherited
credential environment variables and host-side extensions are not isolated by
these file rules. Keep secrets out of the environment you start `pi` from.

Shell network defaults allow exact GitHub source/download and package-registry
hosts, without domain wildcards. Allow additional hosts per task with the network
prompt or `/net allow <domain>`. Prefer session grants over "Allow forever" and
keep `/net open` exceptional. Blind allows no shell network hosts and does not offer the network
prompt. Web tools use their own public-address checks.
Use Container mode only when the task requires daemon access.

In Ghostty, Left Option+M cycles modes on macOS and Alt+M does so on Linux.
Left Option+N / Alt+N toggles shell network filtering. Reload Ghostty's config
with Cmd+Shift+, on macOS after pulling these settings. Other terminals must
send Option as Alt, or use `/perm` and `/net` commands.

## Web tools

The extension gives the local model these tools:

- `search_web`
- `read_url_content`
- `find_text_in_url_content`

The baseline uses DuckDuckGo directly. It keeps search results for 5 minutes and normalized page snapshots for 4 hours within one Pi process. Identical in-flight requests share one fetch. Different requests can run concurrently within the three-request burst and ten-search-per-minute limit.

Downloads are limited to 10 MiB. Normalized pages are limited to 8 MiB. A read returns up to 16,000 characters by default and supports explicit continuation up to 40,000 characters per call. Truncation and continuation offsets are reported.

Nested summarization is disabled. The active local model reads and analyzes the normalized source text.

Search terms go to DuckDuckGo. Page URLs go to their destination sites. Pi records tool calls and results when session storage is enabled. Never put credentials, private file contents, or unpublished finding details in external queries.

The document reader blocks private and reserved addresses, pins each connection to its checked DNS result, and checks every redirect. It handles static HTML, text, Markdown, XML, and JSON. It reports blocked pages, likely JavaScript-only shells, truncation, and rate limits. It does not render JavaScript or extract PDF text.

## Local state

Keep these outside dotty:

- `~/.pi/agent/auth.json`
- model providers and endpoints
- MCP registration and credentials
- Binary Ninja licensing data
- Pi session journals and research evidence

Global `~/.pi/agent/settings.json` and project `.pi/settings.json` can override any web tool value through their `pi-web-search` object.

## Source

`pi-web-search` 3.0.0-dotty.1 is based on `arcanemachine/pi-web-search` commit `035f764f8bb6a68def7d1d46a285ed9e6f63a771`. The local source adds public-network enforcement, DNS pinning, redirect checks, secret-safe model guidance, reproducible dependency locking, target-compatible request timeouts, and the dotty research defaults. The pinned `package-lock.json` SHA-256 is `fdd2a171567c850d06343c2af22e0e48270e67cd52321078648d3960407198b8`.

`pi-permission-modes` 2.8.0-dotty.2 is based on `wynainfo/pi-permission-modes`
2.7.2 commit `652902a`. The local source exposes the runtime's Unix-socket
controls, adds the explicit Container mode, and tells the model when daemon
access is blocked or can escape the remaining sandbox boundaries. It also adds the Blind mode.

`pi-task-checkpoint` 0.1.1-dotty.1 is a copy of `kilbiller/pi-task-checkpoint` 0.1.1. The local
source accepts partial checkpoint updates, shortens over-long values, and starts a task with every
session. Drop the copy if upstream adopts these changes.

The Binary Ninja guard binds MCP calls to one operator-selected local file. Run `/binja-bind <path>` before asking the model to use Binary Ninja.
