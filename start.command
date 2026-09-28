#!/bin/zsh
set -e
cd "${0:A:h}"
if ! command -v node >/dev/null; then
  print 'Node.js が必要です。README.md を参照してください。'
  exit 1
fi
run_pnpm() {
  if command -v pnpm >/dev/null; then pnpm "$@"
  elif command -v corepack >/dev/null; then corepack pnpm "$@"
  else print 'pnpm または Corepack が必要です。'; return 1
  fi
}
if [[ ! -d node_modules ]]; then
  run_pnpm install --frozen-lockfile
fi
print 'Today: http://127.0.0.1:5173/'
run_pnpm dev
