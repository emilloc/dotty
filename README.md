# dots

Terminal setup for Ghostty + herdr + zsh. No plugin managers, no frameworks.

## Files

| File | Installed at | How |
|---|---|---|
| `ghostty.config` | `~/.config/ghostty/config` | symlink |
| `prompt.zsh` | sourced from `~/.zshrc` | `source /Users/emi/dev/dots/prompt.zsh` |
| `fzf-herdr.zsh` | sourced from `~/.zshrc` | `source /Users/emi/dev/dots/fzf-herdr.zsh` |
| `herdr.config.toml` | `~/.config/herdr/config.toml` | copy (herdr keeps logs and sockets in that dir, so no symlink) |
| `init.lua` | `~/.config/nvim/init.lua` | symlink |
| `install.sh` | runs once | links the files above, appends `source` lines to `~/.zshrc`. Rerun safe. |

Install on a new machine:

```sh
git clone <repo> ~/dev/dots && ~/dev/dots/install.sh
brew install fzf bat neovim poppler   # tools the functions call
exec zsh
```

Apply changes:

```sh
exec zsh                        # zsh files
# cmd+shift+,                   # ghostty, in the terminal window
herdr server reload-config      # herdr
```

## ghostty.config

Goal: low eye strain over long sessions.

| Setting | Value | Why |
|---|---|---|
| `theme` | `dark:Gruvbox Material Dark,light:Gruvbox Material Light` | Warm, low-saturation palette. Follows macOS appearance. Light mode reads better in a lit room, dark mode in a dim one. |
| `font-family` | `Menlo` | Only monospace font installed. Swap when you add one. |
| `font-size` | `15` | Larger glyphs, less squinting. |
| `adjust-cell-height` | `30%` | More line spacing. Less eye travel per line. |
| `font-thicken` | `false` | No artificial bolding. Thinner strokes glow less on dark bg. |
| `bold-is-bright` | `false` | Bold keeps its color. No white flashes. |
| `minimum-contrast` | `1.3` | Dim grey text stays readable. |
| `cursor-style` | `bar` | Smaller bright block in your fovea. |
| `cursor-style-blink` | `false` | No periodic flicker. |
| `window-padding-x/y` | `20` / `14` | Text off the window edge. |
| `window-padding-balance` | `true` | Even padding on both sides. |
| `mouse-hide-while-typing` | `true` | Cursor off the text. |
| `macos-titlebar-style` | `tabs` | Tabs in the title bar. |

Alternate palettes with the same warmth: `Everforest Dark Hard`, `Zenburn`. Change only the `dark:` value.

## prompt.zsh

| Line | Why |
|---|---|
| `PROMPT='%F{yellow}%~%f %F{green}❯%f '` | Path and arrow only. No user@host. Yellow and green instead of blue. Blue text on dark bg is hardest to focus. |
| `export CLICOLOR=1` | Colors in `ls`. |
| `export LESS='-R -i -F -X'` | Pager keeps colors, ignores case, quits on short files, leaves output on screen. |
| `export EDITOR=nvim` | Used by `fe` and git. nvim ships syntax colors for markdown. |
| `bindkey -e` | Emacs keys. `EDITOR=nvim` otherwise flips zsh into vi mode and kills ctrl+a / ctrl+e. |
| `v() { nvim -R "$@" }` | Read-only viewer with colors. `q` quits. |
| `alias cat='bat --style=plain'` | Colored cat. No line numbers or frame. Pipes still get raw text. Real cat: `command cat`. |
| `export BAT_THEME=gruvbox-dark` | Match the terminal palette. |
| `hide` / `show` | Toggle the path in this shell only. `hide` for recording, `show` to restore. Other tabs untouched. |
| `pdf FILE` | Read a PDF as text in nvim. Needs poppler. Figures need `open FILE`. |

## fzf-herdr.zsh

Plain `fzf` only prints the pick. tmux popups need `--tmux`. herdr has no floating panes, so this uses a split instead.

| Piece | What it does |
|---|---|
| `fe [fzf args]` | Pick a file. Inside herdr: open it in `$EDITOR` in a right split. The split closes when the editor exits. Outside herdr: open in the same pane. |
| `ctrl-o` | Runs `fe` from the prompt. |
| `fzf ... < /dev/tty` | fzf inside a zle widget needs stdin from the tty. |
| `stty discard undef` | macOS maps ctrl-o to `discard` and eats the key. |

herdr commands used: `herdr pane split <id> --direction right --cwd "$PWD" --focus` and `herdr pane run <id> "<cmd>"`. `$HERDR_PANE_ID` is set inside a herdr pane.

## herdr.config.toml

| Setting | Why |
|---|---|
| `[theme] name = "gruvbox"` | herdr's own gruvbox UI. Sidebar gets its own shade, matches Ghostty's warm family. Alternates: `kanagawa`, `rose-pine`, `vesper`, `nord`. |
| `[theme.custom] panel_bg = "reset"` | Keep the terminal area on the Ghostty background, not herdr's panel color. |

## Habits that matter more than any setting

- macOS light appearance during the day, dark at night. Ghostty follows it.
- Night Shift on a sunset schedule.
- Screen brightness matched to the room.

## init.lua

| Line | Why |
|---|---|
| `termguicolors = false` | nvim's default scheme paints its own truecolor white-on-black. Off, it uses the terminal's 16 ANSI colors, so it matches Ghostty and follows light/dark. |
| `colorscheme("vim")` | Classic scheme, built for 16 colors. |
| `wrap`, `linebreak`, `breakindent` | Long prose lines wrap at words and keep indent. |
| `scrolloff = 8` | Cursor never sits at the screen edge. |
| `number = true` | Line numbers. |
| `cursorline = false`, `showmode = false`, `laststatus = 1` | Less chrome, fewer bright bars. |
| `mouse = "a"` | Scroll and click. |
| `clipboard = "unnamedplus"` | Yank and paste go through the system clipboard. |
| `ignorecase` + `smartcase` | Search ignores case unless you type a capital. |
| `undofile` | Undo history survives closing the file. |
| `mapleader = " "` | Space as leader for future maps. |
| `q` in read-only buffers | `fe` and `v` open read-only. `q` quits like a pager. |
| `path = "**"` | `:find name<tab>` searches the project tree. |
| indent block | 4 spaces default. Tabs for go and asm. |

Built-in editing keys, no plugin:

| Key | Does |
|---|---|
| `gcc` | toggle comment on the line. `gc` + motion for a range, e.g. `gcip` for a paragraph, `gc` in visual mode. |
| `ctrl-n` / `ctrl-p` in insert | word completion from open buffers. |
| `:find name<tab>` | fuzzy-ish file open by name |
| `:Explore` | directory listing in the current window |
