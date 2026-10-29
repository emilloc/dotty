# fzf shell keys: ctrl-r history, ctrl-t paste a path, alt-c cd into a dir.
# fzf older than 0.48 (Ubuntu apt) has no --zsh. Its package ships the same two files.
if fzf --zsh >/dev/null 2>&1; then
  source <(fzf --zsh)
else
  source /usr/share/doc/fzf/examples/key-bindings.zsh
  source /usr/share/doc/fzf/examples/completion.zsh
fi
# file lists respect .gitignore (skips node_modules, .venv), include dotfiles
export FZF_DEFAULT_COMMAND='rg --files --hidden -g "!.git"'

# fzf + herdr: pick a file, open it in a new herdr pane. Pane closes when the editor exits.
# Usage: fe [fzf args]      Key: ctrl-o
fe() {
  local f pane
  f=$(fzf "$@" < /dev/tty) || return
  if [[ -z $HERDR_PANE_ID ]]; then
    ${EDITOR:-vim} "$f"
    return
  fi
  pane=$(herdr pane split "$HERDR_PANE_ID" --direction right --cwd "$PWD" --focus |
    sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p') || return
  herdr pane run "$pane" "exec ${EDITOR:-vim} ${(q)f}" >/dev/null
}

fe-widget() { fe; zle reset-prompt }
zle -N fe-widget
stty discard undef 2>/dev/null
bindkey '^o' fe-widget
