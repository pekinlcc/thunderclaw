#!/usr/bin/env bash
# ThunderClaw 一键 Mac 安装器。
#
# 一行装：
#   curl -fsSL https://raw.githubusercontent.com/pekinlcc/thunderclaw/main/scripts/install-mac.sh | bash
#
# 默认装最新 release。要锁定某个版本：
#   curl -fsSL .../install-mac.sh | bash -s -- 0.1.18
#
# 干的事：
#   1. 装 native host 到 ~/Library/Application Support/ThunderClaw/
#   2. 写 NMH manifest 到 ~/Library/Application Support/{Mozilla,Thunderbird}/NativeMessagingHosts/
#   3. 把 XPI 丢进 TB 默认 profile 的 extensions/ 目录
#   4. 写 user.js：autoDisableScopes=0 + xpinstall.signatures.required=false，让未签名扩展自动启用
#   5. 启动 Thunderbird
#
# 卸载：bash -s -- uninstall

set -euo pipefail

REPO="pekinlcc/thunderclaw"
EXT_ID="thunderclaw@pekinlcc.dev"
TB_APP="/Applications/Thunderbird.app"
TB_PROFILES_DIR="$HOME/Library/Thunderbird"
PROFILES_INI="$TB_PROFILES_DIR/profiles.ini"
LIB_DIR="$HOME/Library/Application Support/ThunderClaw"
NMH_DIRS=(
  "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
  "$HOME/Library/Application Support/Thunderbird/NativeMessagingHosts"
)
WRAPPER="$HOME/.local/bin/thunderclaw-host"

ARG="${1:-install}"

err()  { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }
ok()   { printf "\033[32m✓\033[0m %s\n"  "$*"; }
step() { printf "\n\033[1m==>\033[0m %s\n" "$*"; }

require_cmd() {
  local cmd="$1" hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "缺少 '$cmd'：$hint"
    exit 1
  fi
}

resolve_version() {
  local v="$1"
  if [[ "$v" == "latest" || -z "$v" ]]; then
    curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
      | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1
  else
    echo "$v"
  fi
}

# 解析 profiles.ini，返回 default profile 的绝对路径
default_profile_path() {
  if [[ ! -f "$PROFILES_INI" ]]; then
    err "找不到 $PROFILES_INI——你需要至少启动一次 Thunderbird 让它建出 profile，然后再跑本脚本"
    exit 1
  fi
  # awk：先找 [Install*] 段里的 Default= 路径，没有的话退到 [Profile*] 段里 Default=1 的，
  # 再退到第一个 [Profile*] 段的 Path=
  local rel
  rel=$(awk '
    /^\[Install/ { in_install=1; in_profile=0; next }
    /^\[Profile/ { in_profile=1; in_install=0; def=0; path=""; next }
    /^\[/        { in_install=0; in_profile=0 }
    in_install   { if ($0 ~ /^Default=/) { sub(/^Default=/,""); install_default=$0 } }
    in_profile {
      if ($0 ~ /^Path=/)    { sub(/^Path=/,""); path=$0 }
      if ($0 ~ /^Default=1/) { def=1 }
    }
    END {
      if (install_default != "") { print install_default; exit }
      # 这里没 install_default，就在第二轮里找 Default=1，从 awk 单遍取不到，所以这部分由调用方兜底
    }
  ' "$PROFILES_INI")
  if [[ -n "$rel" ]]; then
    echo "$TB_PROFILES_DIR/$rel"; return
  fi
  # 兜底：扫一遍所有 [Profile*]，取 Default=1 的，没有就第一个
  rel=$(awk '
    /^\[Profile/  { p=""; d=0; in_p=1; next }
    /^\[/         { if (in_p && d==1) { print p; in_p=0; exit } in_p=0 }
    in_p && /^Path=/    { sub(/^Path=/,""); p=$0 }
    in_p && /^Default=1/ { d=1 }
    END           { if (in_p && d==1) print p }
  ' "$PROFILES_INI")
  if [[ -z "$rel" ]]; then
    rel=$(awk '/^\[Profile/{f=1; next} /^\[/{f=0} f && /^Path=/{sub(/^Path=/,""); print; exit}' "$PROFILES_INI")
  fi
  if [[ -z "$rel" ]]; then
    err "解析 $PROFILES_INI 失败——找不到任何 profile"
    exit 1
  fi
  echo "$TB_PROFILES_DIR/$rel"
}

install() {
  local version="$1"
  step "Mac 一键装 ThunderClaw v$version"

  # ─── prerequisites ───────────────────────────────
  require_cmd curl "用 \`brew install curl\` 或自带的 curl"
  require_cmd node "Node.js v18+：https://nodejs.org/ 或 \`brew install node\`"
  require_cmd tar  "macOS 自带，理论上不会缺"

  if [[ ! -d "$TB_APP" ]]; then
    err "找不到 $TB_APP——请先装 Thunderbird：https://www.thunderbird.net/"
    exit 1
  fi

  # ─── tmp work dir ────────────────────────────────
  local tmp; tmp=$(mktemp -d -t thunderclaw)
  trap "rm -rf '$tmp'" EXIT

  # ─── 1) native host tarball ──────────────────────
  step "下载并安装 native host"
  local host_url="https://github.com/$REPO/releases/download/v$version/thunderclaw-native-host-v$version.tar.gz"
  curl -fSL --progress-bar -o "$tmp/host.tar.gz" "$host_url" \
    || { err "下载 host tarball 失败：$host_url"; exit 1; }
  tar -xzf "$tmp/host.tar.gz" -C "$tmp"
  ( cd "$tmp/thunderclaw-native-host-v$version" && node scripts/install-native-host.mjs )

  # ─── 2) XPI ───────────────────────────────────────
  step "下载 XPI"
  local xpi="$tmp/thunderclaw-$version.xpi"
  local xpi_url="https://github.com/$REPO/releases/download/v$version/thunderclaw-$version.xpi"
  curl -fSL --progress-bar -o "$xpi" "$xpi_url" \
    || { err "下载 XPI 失败：$xpi_url"; exit 1; }

  # ─── 3) 把 XPI 丢进 TB 默认 profile 的 extensions/ ───
  local profile_dir; profile_dir=$(default_profile_path)
  step "目标 TB profile：$profile_dir"
  if [[ ! -d "$profile_dir" ]]; then
    err "profile 目录不存在：$profile_dir——是不是 TB 还没初始化？先启动一次 TB 再来"
    exit 1
  fi
  mkdir -p "$profile_dir/extensions"
  cp "$xpi" "$profile_dir/extensions/$EXT_ID.xpi"
  ok "扩展已落到 $profile_dir/extensions/$EXT_ID.xpi"

  # ─── 4) user.js：自动启用 + 关签名校验 ───────────────
  # 这三条 pref 覆盖 TB 默认对未签名扩展的限制，让 sideload 装的 XPI 直接 enabled。
  local user_js="$profile_dir/user.js"
  local marker="// thunderclaw:auto-enable"
  if ! grep -q "$marker" "$user_js" 2>/dev/null; then
    step "写 $user_js（自动启用 + 关签名校验）"
    {
      echo ""
      echo "$marker  # 由 install-mac.sh 写入"
      echo 'user_pref("extensions.autoDisableScopes", 0);'
      echo 'user_pref("extensions.enabledScopes", 15);'
      echo 'user_pref("xpinstall.signatures.required", false);'
    } >> "$user_js"
    ok "已加入 user.js"
  else
    ok "user.js 已含 thunderclaw 配置，跳过"
  fi

  # ─── 5) 起 TB ───────────────────────────────────
  step "启动 Thunderbird"
  # 先确保它没在跑——如果在跑，我们的 user.js 改动要重启才生效
  if pgrep -x thunderbird >/dev/null 2>&1; then
    echo "  Thunderbird 在运行——为应用 user.js 改动需要重启。先 osascript 让它退出："
    osascript -e 'tell application "Thunderbird" to quit' || true
    # 等它优雅退出
    for _ in {1..10}; do
      pgrep -x thunderbird >/dev/null 2>&1 || break
      sleep 0.5
    done
  fi
  open -a Thunderbird
  ok "TB 已启动。如果右上角有红条，说明还有问题——把日志贴给 ThunderClaw 维护者"

  printf "\n\033[32m装完了。\033[0m 直接用就行：左侧 Spaces 栏点 'AI 助手' 图标。\n"
}

uninstall() {
  step "卸载 ThunderClaw"
  # native host
  rm -rf "$LIB_DIR"
  rm -f "$WRAPPER"
  for d in "${NMH_DIRS[@]}"; do
    rm -f "$d/thunderclaw.json"
  done
  ok "native host 已移除"

  # XPI from every profile
  if [[ -f "$PROFILES_INI" ]]; then
    while IFS= read -r p; do
      if [[ -n "$p" ]]; then
        rm -f "$TB_PROFILES_DIR/$p/extensions/$EXT_ID.xpi"
      fi
    done < <(awk '/^\[Profile/{f=1; next} /^\[/{f=0} f && /^Path=/{sub(/^Path=/,""); print}' "$PROFILES_INI")
    ok "扩展已从所有 profile 移除"
  fi

  printf "\n注：留下了 user.js 里那三条 pref——它们对其它未签名扩展也有用，要彻底清自己删 ~/Library/Thunderbird/Profiles/*/user.js 里 thunderclaw 标记下方的行。\n"
}

case "$ARG" in
  install|"")
    install "$(resolve_version "${2:-latest}")"
    ;;
  uninstall|remove)
    uninstall
    ;;
  *)
    # 没匹配，可能是用户直接传了 version
    install "$(resolve_version "$ARG")"
    ;;
esac
