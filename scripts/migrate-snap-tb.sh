#!/usr/bin/env bash
# 把 snap Thunderbird 迁到 Mozilla 官方 tarball 版。
# Ubuntu 24.04 的 xdg-desktop-portal 没暴露 WebExtensions backend，
# snap TB 上 native messaging 完全走不通——ThunderClaw 必须搬到 tarball。
#
# 干的事：
#   1. 备份 snap profile 的邮件账户 + 数据到 ~/.thunderbird/
#   2. 卸 snap thunderbird + apt thunderbird stub
#   3. 下 Mozilla 官方 ESR tarball 到 ~/opt/thunderbird/
#   4. /usr/local/bin/thunderbird → ~/opt/thunderbird/thunderbird
#   5. 注册 .desktop entry 让 dock 图标用 tarball 启动
#
# 一行：
#   bash <(curl -fsSL https://raw.githubusercontent.com/pekinlcc/thunderclaw/main/scripts/migrate-snap-tb.sh)

set -eo pipefail

err()  { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }
ok()   { printf "\033[32m✓\033[0m %s\n"  "$*"; }
step() { printf "\n\033[1m==>\033[0m %s\n" "$*"; }

TB_OPT_DIR="$HOME/opt/thunderbird"
SNAP_PROFILES="$HOME/snap/thunderbird/common/.thunderbird"
TARBALL_PROFILES="$HOME/.thunderbird/Profiles"

# ─── 0) 预检 ────────────────────────────────
if ! command -v sudo >/dev/null 2>&1; then
  err "需要 sudo（卸 snap + 装 /usr/local/bin 软链）"; exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  err "需要 curl"; exit 1
fi

# ─── 1) 退所有 TB 进程 ─────────────────────
step "退出 Thunderbird"
pgrep -f thunderbird-bin | xargs -r kill -SIGTERM 2>/dev/null || true
sleep 3
pgrep -f thunderbird-bin | xargs -r kill -9 2>/dev/null || true

# ─── 2) 备份 snap profile ──────────────────
if [[ -d "$SNAP_PROFILES" ]]; then
  step "备份 snap profile 到 ~/.thunderbird/"
  mkdir -p "$TARBALL_PROFILES"
  for p in "$SNAP_PROFILES"/*.default*; do
    [[ -d "$p" ]] || continue
    name=$(basename "$p")
    if [[ ! -d "$TARBALL_PROFILES/$name" ]]; then
      cp -a "$p" "$TARBALL_PROFILES/$name"
      ok "复制 → $TARBALL_PROFILES/$name"
    fi
  done
  # 找 default profile name
  default_name=$(ls -1 "$SNAP_PROFILES" | grep -E '\.default(-release)?$' | head -1)
  if [[ -n "$default_name" ]]; then
    cat > "$HOME/.thunderbird/profiles.ini" <<EOF
[Install4F96D1932A9F858E]
Default=Profiles/$default_name
Locked=1

[Profile0]
Name=default
IsRelative=1
Path=Profiles/$default_name
Default=1

[General]
StartWithLastProfile=1
Version=2
EOF
    ok "profiles.ini 写好（默认指向 $default_name）"
  fi
fi

# ─── 3) 卸 snap + apt thunderbird stub ─────
step "卸载 snap thunderbird + apt stub"
sudo snap remove thunderbird 2>/dev/null || true
sudo apt-get remove -y thunderbird 2>/dev/null || true
# 顺便清 snap saved snapshots（snap remove 会 auto-save）
SAVED_IDS=$(sudo snap saved 2>/dev/null | awk 'NR>1 {print $1}')
for id in $SAVED_IDS; do sudo snap forget "$id" 2>/dev/null || true; done
rm -rf "$HOME/snap/thunderbird"
ok "snap 数据清理完毕"

# ─── 4) 下 Mozilla ESR tarball ──────────────
step "下载 Mozilla Thunderbird ESR tarball"
mkdir -p "$HOME/opt"
TARBALL_URL="https://download.mozilla.org/?product=thunderbird-esr-latest-ssl&os=linux64&lang=zh-CN"
TMP=$(mktemp -d -t thunderbird-tb)
curl -fSL --progress-bar -o "$TMP/thunderbird.tar.xz" "$TARBALL_URL"
rm -rf "$TB_OPT_DIR"
tar -xJf "$TMP/thunderbird.tar.xz" -C "$HOME/opt/"
rm -rf "$TMP"
ok "TB → $TB_OPT_DIR ($("$TB_OPT_DIR/thunderbird" --version 2>&1 | tail -1))"

# ─── 5) /usr/local/bin/thunderbird 软链 + desktop entry ──
step "注册 thunderbird 命令 + dock 图标"
sudo ln -sf "$TB_OPT_DIR/thunderbird" /usr/local/bin/thunderbird
ok "/usr/local/bin/thunderbird → $TB_OPT_DIR/thunderbird"

# 装 hicolor 图标主题
for size in 16 22 24 32 48 64 128 256; do
  src="$TB_OPT_DIR/chrome/icons/default/default${size}.png"
  if [[ -f "$src" ]]; then
    dst="$HOME/.local/share/icons/hicolor/${size}x${size}/apps"
    mkdir -p "$dst"
    cp "$src" "$dst/thunderbird.png"
  fi
done
gtk-update-icon-cache -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/thunderbird.desktop" <<EOF
[Desktop Entry]
Version=1.0
Name=Thunderbird
GenericName=Mail Client
Comment=Send and receive mail with Thunderbird
Exec=$TB_OPT_DIR/thunderbird %u
Icon=thunderbird
Terminal=false
Type=Application
Categories=Network;Email;
MimeType=x-scheme-handler/mailto;application/x-xpinstall;message/rfc822;
StartupWMClass=Thunderbird
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
ok "desktop entry 已注册"

printf "\n\033[32m迁移完了。\033[0m\n"
echo "  - 起 TB：thunderbird  或者点 dock 图标"
echo "  - 邮件账户密码可能需要重新输入（key4.db / logins.json 跨 TB 实例不一定继承）"
echo "  - 现在可以装 ThunderClaw："
echo "      curl -fsSL https://raw.githubusercontent.com/pekinlcc/thunderclaw/main/scripts/install-linux.sh | bash"
