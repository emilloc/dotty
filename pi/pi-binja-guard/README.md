# pi-binja-guard

This Pi extension binds Binary Ninja MCP calls to one operator-selected local file or directory. It selects and verifies the target's recommended BinaryView before every allowed call. Direct Binary Ninja MCP calls remain blocked.

## Use

Start Pi with the extension:

```bash
pi -e ~/dev/dotty/pi/pi-binja-guard
```

For one fixed target, open it in Binary Ninja and bind the same exact local file in Pi:

```text
/binja-bind /absolute/path/to/target.bin
```

Ask Pi to analyze the binary. The model calls `binja_call`, which checks the binding before it calls a Binary Ninja MCP tool.

For patch diffing or model-selected artifacts, bind a directory instead:

```text
/binja-bind /absolute/path/to/authorized/artifacts
```

The model uses `binja_open` to open regular files inside that directory, `binja_switch` to move between already-open files, and `binja_call` for analysis. Canonical paths outside the bound directory are rejected. The directory binding follows the active Pi session branch, including the selected file.

Run `/binja-bind` with no argument to show the current binding. Run `/binja-bind off` to clear it. Bind again for a new session.

## Boundary

This extension guards Pi tool calls to the MCP server named `binaryninja`. Directory mode limits model-controlled opens and switches to regular files whose canonical paths remain below the operator-selected directory. The extension does not sandbox Pi, the shell, the filesystem, Binary Ninja, or direct HTTP clients. A model can still bypass this guard through `bash` or another extension if those tools can reach `http://127.0.0.1:24642/mcp`.

## Test

On a machine with Node.js 22 or newer:

```bash
npm test
```
