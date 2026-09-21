-- Use the terminal's 16-color palette instead of nvim's own truecolor scheme.
-- Colors then follow Ghostty (Gruvbox Material, light or dark).
vim.o.termguicolors = false
vim.cmd.colorscheme("vim")

-- reading comfort
vim.o.wrap = true          -- long lines wrap
vim.o.linebreak = true     -- wrap at words, not mid-word
vim.o.breakindent = true   -- wrapped lines keep indent
vim.o.scrolloff = 8        -- keep 8 lines of context above/below the cursor
vim.o.number = true        -- line numbers
vim.o.laststatus = 1       -- statusline only with 2+ windows
vim.o.showmode = false     -- no -- INSERT -- flash
vim.o.cursorline = false   -- no bright bar following the cursor

-- behavior
vim.o.mouse = "a"          -- scroll and click
vim.o.clipboard = "unnamedplus"  -- yank/paste use the system clipboard
vim.o.ignorecase = true
vim.o.smartcase = true     -- case-sensitive only if the search has capitals
vim.o.undofile = true      -- undo survives reopen
vim.g.mapleader = " "

-- q quits a read-only buffer (fe / v open files this way)
vim.api.nvim_create_autocmd("BufReadPost", {
  callback = function()
    if vim.o.readonly then
      vim.keymap.set("n", "q", "<cmd>q<cr>", { buffer = true })
    end
  end,
})

-- :find <name><tab> searches the whole project tree
vim.o.path = "**"
vim.o.wildignore = "*/.git/*,*/node_modules/*,*/.venv/*,*/__pycache__/*"

-- indentation per language (syntax colors are built in, nothing to enable)
vim.o.expandtab = true
vim.o.shiftwidth = 4
vim.o.tabstop = 4
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "go", "asm", "nasm" },
  callback = function() vim.bo.expandtab = false; vim.bo.shiftwidth = 8; vim.bo.tabstop = 8 end,
})
