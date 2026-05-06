#!/usr/bin/env bash
# ThunderClaw native messaging host wrapper (system-wide install).
# Bridges Thunderbird's spawned environment to a usable PATH so we can find
# claude / codex / node regardless of how lean the spawning env was.

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

if [[ -d "$HOME/.nvm/versions/node" ]]; then
  for d in "$HOME/.nvm/versions/node"/*/bin; do
    [[ -d "$d" ]] && PATH="$d:$PATH"
  done
  export PATH
fi

NODE_BIN=""
for cand in node nodejs; do
  if command -v "$cand" >/dev/null 2>&1; then
    NODE_BIN="$(command -v $cand)"
    break
  fi
done
if [[ -z "$NODE_BIN" ]]; then
  echo "thunderclaw-host: no node binary in PATH (after augment): $PATH" >&2
  exit 127
fi
exec "$NODE_BIN" /usr/lib/thunderclaw/index.mjs "$@"
