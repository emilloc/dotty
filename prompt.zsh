# minimal prompt + colors, no plugins
autoload -Uz colors && colors
setopt PROMPT_SUBST
PROMPT='%F{yellow}%~%f %F{green}❯%f '
export CLICOLOR=1
export LESS='-R -i -F -X'
export EDITOR=nvim
bindkey -e   # emacs keys; EDITOR=nvim otherwise flips zsh to vi mode
# history: keep ~everything, timestamped, shared live across splits.
# A command typed with a leading space is not saved (use for secrets).
HISTFILE=~/.zsh_history
HISTSIZE=1000000 SAVEHIST=1000000
setopt EXTENDED_HISTORY SHARE_HISTORY HIST_IGNORE_DUPS HIST_IGNORE_SPACE
# tab completes subcommands and flags (git, brew, ...), case-insensitive
autoload -Uz compinit && compinit
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'
# ctrl-x ctrl-e: edit the current command line in $EDITOR, runs on :wq
autoload -Uz edit-command-line && zle -N edit-command-line
bindkey '^x^e' edit-command-line
# view a file read-only with syntax colors: v FILE
v() { nvim -R "$@" }
alias cat='bat --style=plain'
export BAT_THEME=gruvbox-dark
# hide/show the path in this shell only (recording)
hide() { PROMPT='%F{green}❯%f ' }
show() { PROMPT='%F{yellow}%~%f %F{green}❯%f ' }
# read a pdf as text in nvim: pdf FILE
pdf() { pdftotext -layout "$1" - | nvim -R - }
# view a fully rendered pdf inline (Ghostty kitty graphics): pdfv FILE [dpi]
# 300 dpi so HiDPI downscales (sharp) instead of upscaling a low-res raster (blur).
pdfv() {
  local d=$(mktemp -d)
  pdftoppm -png -r "${2:-300}" "$1" "$d/p" && timg "$d"/p*.png
  rm -rf "$d"
}
# cd learns dirs you visit and jumps by partial name: cd feed -> most-used match.
# --cmd cd replaces cd; a real path still cds normally, else it jumps. cdi = pick.
eval "$(zoxide init zsh --cmd cd)"
