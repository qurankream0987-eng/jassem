#!/usr/bin/env bash
set -euo pipefail

state_file="$(mktemp "${TMPDIR:-/tmp}/jasim-block0-restart.XXXXXX.json")"
cleanup() {
  rm -f "$state_file"
}
trap cleanup EXIT

set +e
pnpm exec tsx --tsconfig ../canonical/جاسم/app/tsconfig.server.json \
  ./src/jasim-block0-restart-proof.ts setup "$state_file"
setup_status=$?
set -e

if [[ "$setup_status" -ne 137 || ! -s "$state_file" ]]; then
  echo "restart setup did not terminate with the expected crash state" >&2
  exit 1
fi

pnpm exec tsx --tsconfig ../canonical/جاسم/app/tsconfig.server.json \
  ./src/jasim-block0-restart-proof.ts recover "$state_file"