#!/bin/sh
# Link this directory's files into place. Safe to rerun.
set -e
D=$(cd "$(dirname "$0")" && pwd)

mkdir -p ~/.config/ghostty ~/.config/nvim ~/.config/herdr
ln -sfn "$D/ghostty.config" ~/.config/ghostty/config
ln -sfn "$D/init.lua"       ~/.config/nvim/init.lua
[ -f ~/.config/herdr/config.toml ] || cp "$D/herdr.config.toml" ~/.config/herdr/config.toml

# zoxide insists on being the last thing in .zshrc and warns on every prompt if
# it isn't, so append above its block rather than below it.
for f in prompt.zsh fzf-herdr.zsh; do
  if ! grep -qF "$D/$f" ~/.zshrc 2>/dev/null; then
    if grep -q zoxide ~/.zshrc 2>/dev/null; then
      awk -v l="source $D/$f" '/zoxide/ && !ins {print l; ins=1} {print}' ~/.zshrc > ~/.zshrc.new
      mv ~/.zshrc.new ~/.zshrc
    else
      echo "source $D/$f" >> ~/.zshrc
    fi
  fi
done
echo "done. run: exec zsh"
