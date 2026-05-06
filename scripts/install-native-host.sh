#!/usr/bin/env bash
# 安装 ThunderClaw Native Messaging Host (Linux)
# 把 host wrapper 放到 ~/.local/bin/，manifest 放到 Thunderbird 能找到的多个位置（含 snap）。

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_SRC="$REPO_DIR/native-host"
NAME="thunderclaw"
EXT_ID="thunderclaw@pekinlcc.dev"

# 1. 把 native-host/ 复制到 ~/.local/share/thunderclaw/
LIB_DIR="$HOME/.local/share/thunderclaw"
mkdir -p "$LIB_DIR"
cp "$HOST_SRC"/*.mjs "$LIB_DIR/"

# 2. 写一个 wrapper 脚本到 ~/.local/bin/
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
WRAPPER="$BIN_DIR/thunderclaw-host"
cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
# ThunderClaw NMH wrapper.
# snap Thunderbird spawn 子进程时给的 PATH 很贫瘠，这里手动补全用户常见的 bin 目录，
# 这样 native host 里 \`which claude\` / \`which codex\` / \`which node\` 才能找到。
export PATH="\$HOME/.local/bin:\$HOME/.npm-global/bin:\$HOME/.bun/bin:\$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:\$PATH"

# 还要把用户可能用的 nvm / volta 也兜底
if [[ -d "\$HOME/.nvm/versions/node" ]]; then
  for d in "\$HOME/.nvm/versions/node"/*/bin; do
    [[ -d "\$d" ]] && PATH="\$d:\$PATH"
  done
  export PATH
fi

NODE_BIN=""
for cand in node nodejs; do
  if command -v "\$cand" >/dev/null 2>&1; then
    NODE_BIN="\$(command -v \$cand)"
    break
  fi
done
if [[ -z "\$NODE_BIN" ]]; then
  echo "thunderclaw-host: no node binary in PATH (after augment): \$PATH" >&2
  exit 127
fi
exec "\$NODE_BIN" "$LIB_DIR/index.mjs" "\$@"
EOF
chmod +x "$WRAPPER"

# 3. 生成 manifest
TMP_MANIFEST="$(mktemp)"
sed "s#__HOST_PATH__#$WRAPPER#g" "$HOST_SRC/manifest.template.json" > "$TMP_MANIFEST"

# 4. 把 manifest 安装到 Thunderbird 能找的位置（多放几个，覆盖 snap / 非 snap / Mozilla 旧路径）
PATHS=(
  "$HOME/.thunderbird/native-messaging-hosts"
  "$HOME/.mozilla/native-messaging-hosts"
  "$HOME/snap/thunderbird/common/.thunderbird/native-messaging-hosts"
  "$HOME/snap/thunderbird/common/.mozilla/native-messaging-hosts"
)

for dir in "${PATHS[@]}"; do
  mkdir -p "$dir"
  cp "$TMP_MANIFEST" "$dir/$NAME.json"
  echo "  ✓ $dir/$NAME.json"
done

rm -f "$TMP_MANIFEST"

echo ""
echo "✓ Native Host installed."
echo "  wrapper: $WRAPPER"
echo "  library: $LIB_DIR/"
echo "  allowed extension id: $EXT_ID"
echo ""
echo "提示：snap 版 Thunderbird 可能因沙箱限制无法 spawn 任意 ~/.local/bin 下的进程。"
echo "如果之后扩展报 'No such native application thunderclaw'，请改用非 snap 版 Thunderbird。"
