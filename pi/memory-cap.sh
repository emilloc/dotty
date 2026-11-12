# Sourced by bash and zsh. On Linux, start Pi in a systemd scope limited to 60% of installed memory,
# so a runaway script is killed before the desktop freezes. OOMPolicy=continue keeps Pi running.
# Does nothing on macOS.
command -v systemd-run >/dev/null && alias pi='systemd-run --user --scope -q -p MemoryMax=60% -p MemorySwapMax=2G -p OOMPolicy=continue pi'
