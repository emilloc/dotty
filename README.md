# dotty

Terminal setup for Ghostty, herdr, zsh and nvim on macOS and Ubuntu. Plain config files, no plugin managers.

## tl;dr

macOS:

```sh
brew install fzf ripgrep bat neovim poppler timg zoxide
git clone https://github.com/emilloc/dotty.git ~/dev/dotty && ~/dev/dotty/install.sh
exec zsh
```

Ubuntu:

```sh
sudo apt install zsh ripgrep bat poppler-utils timg fzf zoxide wl-clipboard xclip
sudo snap install nvim --classic                          # apt neovim on 24.04 is too old
sudo add-apt-repository ppa:mkasberg/ghostty-ubuntu       # 24.04. From 26.04 skip this line
sudo apt update && sudo apt install ghostty
curl -fsSL https://herdr.dev/install.sh | sh
git clone https://github.com/emilloc/dotty.git ~/dev/dotty && ~/dev/dotty/install.sh
echo 'font-family = DejaVu Sans Mono' > ~/.config/ghostty/local
chsh -s "$(command -v zsh)"                               # takes effect on the next login
```

Apply a change:

```
exec zsh                       zsh files
cmd+shift+,   ctrl+shift+,     ghostty on macOS / Linux
herdr server reload-config     herdr
```

## Files

```
dotty/                how       installed at
ghostty.config        symlink   ~/.config/ghostty/config
                                ~/.config/ghostty/local        you write this one per machine, untracked
init.lua              symlink   ~/.config/nvim/init.lua
herdr.config.toml     copy      ~/.config/herdr/config.toml    a copy, because herdr writes logs next to it
prompt.zsh            source    ~/.zshrc
fzf-herdr.zsh         source    ~/.zshrc
install.sh                      does all of the above. Safe to rerun.
```

## Keys

On macOS the option key types accents, so for an alt shortcut press `esc` and then the key. On Linux the alt key works directly.

Shell line:

```
opt+left  opt+right   back / forward one word          Linux: alt+arrows or ctrl+arrows
ctrl-a  ctrl-e        start / end of the line
ctrl-w                delete the word before the cursor
ctrl-u  ctrl-k        delete the whole line / to the end
ctrl-y                paste what the last delete removed
ctrl-_                undo
esc .                 insert the last argument of the previous command. Repeat for older ones.
ctrl-x ctrl-e         edit the line in nvim.  :wq runs it,  :cq drops it
ctrl-o                fe: pick a file and open it in nvim. Inside herdr it opens in a right split.
tab                   complete commands, subcommands, flags and paths
 cmd                  a leading space keeps the command out of history. Use it for secrets.
```

fzf:

```
ctrl-r                search history. Type pieces in any order:  ssh prod   or   curl 443 api
ctrl-t                pick a file and paste its path. Example: type v and a space, then ctrl-t
esc c                 pick a directory and cd into it            Linux: alt+c
v src/**<tab>         picker scoped to src/. The pick lands in place.
cd **<tab>            pick a directory
kill <tab>            pick a process
ssh **<tab>           pick a host from ~/.ssh/config

inside the picker
'word  exact      !word  exclude      ^word  starts with      word$  ends with      a | b  either
tab / shift-tab   mark several        ctrl-j / ctrl-k   down / up
```

History and logs:

```
history -i 1                   every saved command, with dates
history -i 1 | rg docker       search it
cmd 2>&1 | tee run.log         watch live and keep a copy
v run.log                      read it in nvim:   / search   n next   G end   q quit
```

Jumping:

```
cd part        zoxide: the most used directory matching part
cdi            pick among zoxide's directories
cd -           the previous directory
```

Ghostty splits and tabs, all default bindings:

```
                  macOS                 Linux
split right       cmd+d                 ctrl+shift+o
split down        cmd+shift+d           ctrl+shift+e
move              cmd+[   cmd+]         ctrl+alt+arrows
move by direction cmd+opt+arrows
zoom a split      cmd+shift+enter       ctrl+shift+enter
new tab           broken, see below     ctrl+shift+t
go to tab                               alt+1 to alt+9
close             cmd+w                 ctrl+shift+w
copy / paste      cmd+c   cmd+v         ctrl+shift+c   ctrl+shift+v
```

nvim, built in:

```
gcc                toggle a comment.  gc + motion for a range, gcip for a paragraph
ctrl-n  ctrl-p     complete a word from open buffers, in insert mode
:find name<tab>    open a file by name from anywhere in the project
:Explore           directory listing
q                  quit a read-only buffer. fe and v open files that way.
```

Recording a demo:

```
hide     take the path off the prompt, in this shell only
clear    wipe the "Last login" line
show     put the path back
```

## ghostty.config

The goal is low eye strain over long sessions.

- The theme is Gruvbox Material. It follows the OS appearance, light by day and dark at night. The palette is warm with low saturation. `Everforest Dark Hard` and `Zenburn` have the same warmth.
- The font is Menlo at size 15 with 30% taller cells. Glyphs are bigger and lines sit further apart.
- Font thickening is off, bold keeps its color, and the minimum contrast is 1.3. Bright strokes do not glow and dim grey text stays readable.
- The cursor is a bar and does not blink, so nothing flickers in the center of your view.
- Padding is 20 by 14 and balanced. The mouse pointer hides while you type.
- The titlebar is hidden on macOS. This breaks tabs. The window leaves the macOS tab group, so `cmd+t` opens a tab you cannot return to, and `cmd+1` or `cmd+shift+[` do nothing. Use splits. To get tabs back, set `macos-titlebar-style = tabs`. Verified on Ghostty 1.3.1.
- Scrollback is 100 MB per split instead of the default 10 MB. Inside herdr, herdr's own limit applies.
- `copy-on-select = clipboard` puts a mouse selection in the system clipboard.
- `shell-integration-features = ssh-terminfo` copies Ghostty's terminfo to a host on the first `ssh`, so `clear`, `less` and `nvim` work there.
- `config-file = ?local` loads `~/.config/ghostty/local` when it exists. The file is untracked and holds per-machine values, such as the font on Linux.

## prompt.zsh

- The prompt shows the path and `❯` in yellow and green. Blue on a dark background is the hardest color to focus on.
- It sources Ghostty's shell integration again, so `exec zsh` keeps the cursor shape, the prompt marks and the `ssh` wrapper.
- It puts `~/.local/bin` on PATH. herdr installs there, and zsh never reads the `~/.profile` where Ubuntu adds it.
- Keys are emacs style. Without `bindkey -e`, `EDITOR=nvim` flips zsh into vi mode. Alt+arrows and ctrl+arrows jump by word. Linux needs that, because Ghostty binds opt+arrows only on macOS.
- History keeps 1,000,000 commands with timestamps, shared live between splits. A command typed with a leading space is not saved. The old limit of 1000 was already dropping commands.
- `compinit` completes git and brew subcommands on tab, case-insensitive.
- `ls` is colored on both systems.
- `v` opens a file read-only in nvim. `cat` is `bat` without a frame or line numbers, and `batcat` on Ubuntu. `LESS` keeps colors and quits on short files.
- `pdf FILE` shows the text in nvim. `pdfv FILE [dpi]` renders the pages inline over kitty graphics at 300 dpi, so HiDPI screens downsample instead of blurring.
- zoxide replaces `cd`.

## fzf-herdr.zsh

- It loads the fzf key bindings. apt ships an fzf older than 0.48, which has no `--zsh`, so on Ubuntu it sources the two files the package installs instead.
- `FZF_DEFAULT_COMMAND` is `rg --files --hidden`, so file lists respect `.gitignore`.
- `fe` picks a file and opens it in a herdr split on the right. The split closes with the editor. Outside herdr it opens in the same pane. `ctrl-o` runs it. `stty discard undef` is there because macOS eats `ctrl-o`.

## herdr.config.toml

- The theme is gruvbox and the terminal area keeps Ghostty's background. Scrollback is 100 MB per pane. `herdr config check` validates the file.

## init.lua

- nvim uses the terminal's 16 colors and the classic `vim` scheme, so it follows Ghostty's light and dark. `pcall` keeps an older nvim from aborting the file at that line.
- Lines wrap at words and keep their indent. The cursor stays 8 lines from the edge. Line numbers are on. The status line and the mode text are off.
- The mouse is on. Yank and paste use the system clipboard. Search ignores case unless you type a capital. Undo survives reopening a file. Space is the leader key.
- `q` quits a read-only buffer. `:find` searches the whole tree. Indent is 4 spaces, with tabs for go and asm.

## Linux notes

- Ubuntu ships Ghostty from 26.04. On 24.04 the Ghostty project points to the `ghostty-ubuntu` PPA. It builds amd64 and arm64, up to Ghostty 1.3.1, the same version as the Mac. `snap install ghostty --classic` is an alternative with the same version and an arm64 build. Neither is maintained by the Ghostty project.
- apt neovim is 0.9.5 on 24.04 and lacks `gcc`. The nvim snap is 0.12 and has an arm64 build.
- Run `install.sh` before the first `zsh` start. zsh then finds a `.zshrc` and skips its new-user wizard.
- Linux has no Menlo. The `local` file sets DejaVu Sans Mono, the font Menlo derives from. Without it, Ghostty uses its built-in JetBrains Mono.
- The theme follows the GNOME appearance setting. Tabs work, because Ghostty draws its own tab bar. `macos-*` settings are ignored.
- nvim's clipboard needs `wl-copy` on Wayland or `xclip` on X11. Both are in the apt line.
- If `pdfv` shows colored blocks instead of pages, timg is too old to detect Ghostty. Add `-p k` to its `timg` call.

## Habits that matter more than any setting

- Light appearance by day, dark at night. Ghostty follows it.
- Night Shift on a sunset schedule.
- Screen brightness matched to the room.
