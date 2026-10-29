# pi-binja-guard

This Pi extension binds Binary Ninja MCP calls to one operator-selected local file. It selects and verifies that file's recommended BinaryView before every allowed call. Direct Binary Ninja MCP calls and MCP operations that open, close, list, or switch targets are blocked.

## Use

Start the dotty Pi baseline with the extension:

```bash
~/dev/dotty/pi/pi-web \
    -e ~/dev/dotty/pi/pi-binja-guard
```

Open the target in Binary Ninja. Then bind the same exact local file in Pi:

```text
/binja-bind /absolute/path/to/target.bin
```

Ask Pi to analyze the binary. The model calls `binja_call`, which checks the binding before it calls a Binary Ninja MCP tool.

Run `/binja-bind` with no argument to show the current binding. Run `/binja-bind off` to clear it. The binding follows the active Pi session branch. Bind again for a new session.

## Boundary

This extension guards Pi tool calls to the MCP server named `binaryninja`. It does not sandbox Pi, the shell, the filesystem, Binary Ninja, or direct HTTP clients. A model can still bypass this guard through `bash` or another extension if those tools can reach `http://127.0.0.1:24642/mcp`.

## Test

On a machine with Node.js 22 or newer:

```bash
npm test
```
