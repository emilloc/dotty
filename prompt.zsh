# minimal prompt + colors, no plugins
autoload -Uz colors && colors
setopt PROMPT_SUBST
PROMPT='%F{yellow}%~%f %F{green}❯%f '
export CLICOLOR=1
export LESS='-R -i -F -X'
export EDITOR=nvim
bindkey -e   # emacs keys; EDITOR=nvim otherwise flips zsh to vi mode
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
# cd by project name from anywhere: cd NAME -> ~/dev/NAME. cwd wins first.
export CDPATH=.:$HOME/dev
