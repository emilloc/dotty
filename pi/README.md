# Pi web baseline

This directory contains the portable Pi setup for local models. It does not change `dotty/install.sh`, Pi authentication, model providers, MCP servers, or session storage.

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

The setup requires Pi 1.4.0 or newer, Node.js 22.19 or newer, and npm. It installs the production dependencies pinned in the web-search and permission-mode lockfiles and prepares the pinned launcher packages. Its first run needs internet access. It starts an ephemeral Pi session to verify web tools, permission modes, task checkpoints, and the Binary Ninja guard without sending a model request. It then links `pi-web` and `pi-brief` into `~/.local/bin`. Rerunning setup preserves model configuration and authentication.

On a device without the rest of dotty's shell configuration, add `~/.local/bin` to `PATH` or launch `~/.local/bin/pi-web` directly.

## Start Pi

```sh
pi-web
```

Dotty already puts `~/.local/bin` on `PATH`.

The launcher queries the Spark provider URL in `~/.pi/agent/models.json` and selects its model when
exactly one model is served. Pass `--model spark/<id>` or `--provider <id>` to bypass that discovery.

The launcher always loads:

- the pinned local `pi-permission-modes` 2.8.0-dotty.1 extension
- `pi-task-checkpoint` 0.1.1
- the pinned local `pi-web-search` extension

`pi-task-checkpoint` is loaded but inactive at the start of each session. Activate it before a long
task:

```text
/state --fresh
```

Use `/state <task-id>` instead when resuming an existing task. The extension stores operational
continuation state under the project directory at `.pi/task-state/`. It does not replace the Pi
session journal or research evidence files.

Add the Binary Ninja binding guard when the task needs it:

```sh
pi-web \
    -e ~/dev/dotty/pi/pi-binja-guard
```

Start container and image-builder work in the explicit Container mode:

```sh
pi-web --perm container
```

Default, Plan, and Build block Unix sockets. Container mode permits all Unix
sockets on Linux because seccomp cannot filter them by path, and it permits the
standard Docker socket paths on macOS. It also permits nested user namespaces
for rootless Podman and Buildah. Docker and similar daemons can act outside the
sandbox's filesystem and network limits, so use Container mode only for tasks
that require them.

## On-command briefings

Run `pi-brief` after a milestone is complete or the accompanying notes have a substantial
update. It accepts task state and a text record from any domain, and opens a separate
interactive Pi session for orientation and follow-up questions. `RESEARCH.md` below
is an example filename; the second argument can be any text notes file.

```sh
~/dev/dotty/pi/pi-brief /path/to/.pi/task-state/task-id.json /path/to/RESEARCH.md
```

The next `pi/setup` run also links `pi-brief` into `~/.local/bin`. Node.js must be on
`PATH`. The launcher uses your global Pi default model and existing provider
credentials. It calls base Pi with tools, extensions, MCP, skills, prompt templates,
and project context files disabled. The prompt lives in `briefing-prompt.md`.
Pi starts in the temporary input directory so unrelated project settings and working
directory names do not supply context for the briefing.
The initial response explains the purpose, decisive evidence, its implications, and
the recorded next step. It usually targets 150–300 words. Ask follow-up questions to
explore unfamiliar concepts or supporting detail.

Both records are captured before Pi starts. Their original paths, SHA-256 hashes,
task revision, and capture time accompany the input. The launcher rejects malformed
task state, empty research records, and changes detected during capture. These checks
cannot prove both files describe the same milestone. Invoke it after both writers
have finished. There is no file watcher or checkpoint-triggered generation.

Pi stores the conversation, including the captured input, under
`~/.pi/agent/sessions/briefings/` (or the corresponding `PI_CODING_AGENT_DIR`). Temporary
input copies are removed when Pi exits normally. The launcher leaves the research
files unchanged. The briefing stays in the conversation in this prototype. It does
not write `BRIEFING.md`. Start a new briefing when you need a fresh snapshot.

To revisit a saved briefing with the same restrictions:

```sh
pi --session-dir ~/.pi/agent/sessions/briefings --resume \
    --offline --no-tools --no-extensions --no-mcp --no-skills \
    --no-context-files --no-prompt-templates \
    --system-prompt "$(cat ~/dev/dotty/pi/briefing-prompt.md)"
```

Run the launcher checks without contacting a model:

```sh
node --test ~/dev/dotty/pi/tests/pi-brief.test.cjs
```

## Pi directories

Pi's default user directory is `~/.pi/agent`, singular. It owns the managed Pi executable, settings, models, authentication, MCP configuration, sessions, installed packages, and user extensions. This baseline does not create `~/.pi/agents` or a second agent directory.

The launcher prefers the managed `~/.pi/agent/bin/pi`. It uses a `pi` found on `PATH` only when the managed executable is absent. This prevents an older global npm installation from taking precedence.

The web and permission-mode sources remain under `~/dev/dotty/pi`. Putting them under `~/.pi/agent/extensions` would make them load in every Pi session. Keeping them as explicit local packages preserves the intended split: `pi` keeps its base configuration, while `pi-web` loads the research extensions for that session.

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

Global `~/.pi/agent/settings.json` and project `.pi/settings.json` can override any web baseline value through their `pi-web-search` object.

## Source

`pi-web-search` 3.0.0-dotty.1 is based on `arcanemachine/pi-web-search` commit `035f764f8bb6a68def7d1d46a285ed9e6f63a771`. The local source adds public-network enforcement, DNS pinning, redirect checks, secret-safe model guidance, reproducible dependency locking, target-compatible request timeouts, and the dotty research defaults. The pinned `package-lock.json` SHA-256 is `fdd2a171567c850d06343c2af22e0e48270e67cd52321078648d3960407198b8`.

`pi-permission-modes` 2.8.0-dotty.1 is based on `wynainfo/pi-permission-modes`
2.7.2 commit `652902a`. The local source exposes the runtime's Unix-socket
controls, adds the explicit Container mode, and tells the model when daemon
access is blocked or can escape the remaining sandbox boundaries.

The Binary Ninja guard binds MCP calls to one operator-selected local file. Run `/binja-bind <path>` before asking the model to use Binary Ninja.
