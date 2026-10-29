# Pi web baseline

This directory contains the portable Pi setup for local models. It does not change `dotty/install.sh`, Pi authentication, model providers, MCP servers, or session storage.

## Set up one device

Run this after cloning or pulling dotty:

```sh
~/dev/dotty/pi/setup
```

The setup requires Pi 1.4.0 or newer, Node.js 22.19 or newer, and npm. It installs only the production dependencies pinned in `pi-web-search/package-lock.json`, verifies both local extensions, and links `pi-web` into `~/.local/bin`.

## Start Pi

```sh
pi-web
```

Dotty already puts `~/.local/bin` on `PATH`.

The launcher always loads:

- `pi-permission-modes` 2.7.2
- `pi-task-checkpoint` 0.1.1
- the pinned local `pi-web-search` extension

Add the Binary Ninja binding guard when the task needs it:

```sh
pi-web \
    -e ~/dev/dotty/pi/pi-binja-guard
```

## Pi directories

Pi's default user directory is `~/.pi/agent`, singular. It owns the managed Pi executable, settings, models, authentication, MCP configuration, sessions, installed packages, and user extensions. This baseline does not create `~/.pi/agents` or a second agent directory.

The launcher prefers the managed `~/.pi/agent/bin/pi`. It uses a `pi` found on `PATH` only when the managed executable is absent. This prevents an older global npm installation from taking precedence.

The web source remains under `~/dev/dotty/pi`. Putting it under `~/.pi/agent/extensions` would make web tools load in every Pi session. Keeping it as an explicit local package preserves the intended split: `pi` has no web tools, while `pi-web` loads them for that session.

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

The Binary Ninja guard binds MCP calls to one operator-selected local file. Run `/binja-bind <path>` before asking the model to use Binary Ninja.
