#!/bin/sh
# Link this directory's files into place. Safe to rerun.
set -e
D=$(cd "$(dirname "$0")" && pwd)

mkdir -p ~/.config/ghostty ~/.config/nvim ~/.config/herdr
ln -sfn "$D/ghostty.config" ~/.config/ghostty/config
ln -sfn "$D/init.lua"       ~/.config/nvim/init.lua
[ -f ~/.config/herdr/config.toml ] || cp "$D/herdr.config.toml" ~/.config/herdr/config.toml

for f in prompt.zsh fzf-herdr.zsh; do
  grep -qF "$D/$f" ~/.zshrc 2>/dev/null || echo "source $D/$f" >> ~/.zshrc
done
echo "done. run: exec zsh"
