#!/usr/bin/env bash
# ThunderClaw 一键 Mac 安装器。
#
# 一行装：
#   curl -fsSL https://raw.githubusercontent.com/pekinlcc/thunderclaw/main/scripts/install-mac.sh | bash
#
# 默认装最新 release。要锁定某个版本：
#   curl -fsSL .../install-mac.sh | bash -s -- 0.1.20
#
# 干的事：
#   1. 装 native host 到 ~/Library/Application Support/ThunderClaw/
#   2. 写 NMH manifest 到 ~/Library/Application Support/{Mozilla,Thunderbird}/NativeMessagingHosts/
#   3. 把 XPI 丢进 TB 默认 profile 的 extensions/ 目录
#   4. 写 user.js：autoDisableScopes=0 + xpinstall.signatures.required=false，让未签名扩展自动启用
#   5. 启动 Thunderbird
#
# 卸载：bash -s -- uninstall

# 注意：这里只用 -e + pipefail，不用 -u。
# macOS 自带 bash 3.2.57（2007 年）—— `local var="value"` 在 piped-bash 上下文里
# 时不时不绑定，配合 set -u 会触发误报 unbound variable。下面所有 local 都拆成
# 两行 declare-then-assign，对 bash 3.2 更稳。
set -eo pipefail

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
  local cmd hint
  cmd="$1"
  hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "缺少 '$cmd'：$hint"
    exit 1
  fi
}

resolve_version() {
  local v
  v="$1"
  if [[ "$v" != "latest" && -n "$v" ]]; then
    echo "$v"
    return
  fi
  # 不走 api.github.com（未认证 60 次/小时，重跑两次就 403）。
  # 用 /releases/latest 的 302 → /releases/tag/vX.Y.Z，从 Location header 抽版本号。
  # 这条路径不需要 API token，没限流。
  local resolved
  resolved=$(curl -fsSI "https://github.com/$REPO/releases/latest" 2>/dev/null \
    | awk 'tolower($1) == "location:" { print $2 }' \
    | tr -d '\r\n' \
    | sed -n 's|.*/releases/tag/v||p')
  if [[ -n "$resolved" ]]; then
    echo "$resolved"
    return
  fi
  # 兜底：试一下 API（万一 redirect 路径出了问题，给个后备）
  resolved=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)
  if [[ -n "$resolved" ]]; then
    echo "$resolved"
    return
  fi
  err "无法解析最新版本号——GitHub 暂时连不上？指定版本试试：bash -s -- 0.1.21"
  exit 1
}

# 解析 profiles.ini，返回 default profile 的相对 Path（不含 TB_PROFILES_DIR 前缀）。
# bash 3.2 兼容：避免 local var="$(...)" 这种在 -u 下时常失败的写法。
default_profile_path() {
  if [[ ! -f "$PROFILES_INI" ]]; then
    err "找不到 $PROFILES_INI——你需要至少启动一次 Thunderbird 让它建出 profile，然后再跑本脚本"
    exit 1
  fi

  local rel
  rel=""
  # 优先：[Install*] 段里的 Default=
  rel=$(awk '
    /^\[Install/ { in_install=1; next }
    /^\[/        { in_install=0 }
    in_install   { if ($0 ~ /^Default=/) { sub(/^Default=/,""); print; exit } }
  ' "$PROFILES_INI")
  if [[ -n "$rel" ]]; then
    echo "$TB_PROFILES_DIR/$rel"
    return
  fi

  # 其次：[Profile*] 段里 Default=1 的
  rel=$(awk '
    /^\[Profile/  { p=""; d=0; in_p=1; next }
    /^\[/         { if (in_p && d==1) { print p; in_p=0; exit } in_p=0 }
    in_p && /^Path=/     { sub(/^Path=/,""); p=$0 }
    in_p && /^Default=1/ { d=1 }
    END           { if (in_p && d==1) print p }
  ' "$PROFILES_INI")
  if [[ -n "$rel" ]]; then
    echo "$TB_PROFILES_DIR/$rel"
    return
  fi

  # 兜底：第一个 [Profile*] 段
  rel=$(awk '/^\[Profile/{f=1; next} /^\[/{f=0} f && /^Path=/{sub(/^Path=/,""); print; exit}' "$PROFILES_INI")
  if [[ -z "$rel" ]]; then
    err "解析 $PROFILES_INI 失败——找不到任何 profile"
    exit 1
  fi
  echo "$TB_PROFILES_DIR/$rel"
}

install_main() {
  local version
  version="$1"
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
  local tmp
  tmp=$(mktemp -d -t thunderclaw)
  trap "rm -rf '$tmp'" EXIT

  # ─── 1) native host tarball ──────────────────────
  step "下载并安装 native host"
  local host_url
  host_url="https://github.com/$REPO/releases/download/v$version/thunderclaw-native-host-v$version.tar.gz"
  curl -fSL --progress-bar -o "$tmp/host.tar.gz" "$host_url" \
    || { err "下载 host tarball 失败：$host_url"; exit 1; }
  tar -xzf "$tmp/host.tar.gz" -C "$tmp"
  ( cd "$tmp/thunderclaw-native-host-v$version" && node scripts/install-native-host.mjs )

  # ─── 2) XPI ───────────────────────────────────────
  step "下载 XPI"
  local xpi xpi_url
  xpi="$tmp/thunderclaw-$version.xpi"
  xpi_url="https://github.com/$REPO/releases/download/v$version/thunderclaw-$version.xpi"
  curl -fSL --progress-bar -o "$xpi" "$xpi_url" \
    || { err "下载 XPI 失败：$xpi_url"; exit 1; }

  # ─── 3) 把 XPI 丢进 TB 默认 profile 的 extensions/ ───
  local profile_dir
  profile_dir=$(default_profile_path)
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
  local user_js marker
  user_js="$profile_dir/user.js"
  marker="// thunderclaw:auto-enable"
  if ! grep -q "$marker" "$user_js" 2>/dev/null; then
    step "写 $user_js（自动启用 + 关签名校验）"
    {
      printf '\n%s  # 由 install-mac.sh 写入\n' "$marker"
      printf 'user_pref("extensions.autoDisableScopes", 0);\n'
      printf 'user_pref("extensions.enabledScopes", 15);\n'
      printf 'user_pref("xpinstall.signatures.required", false);\n'
    } >> "$user_js"
    ok "已加入 user.js"
  else
    ok "user.js 已含 thunderclaw 配置，跳过"
  fi

  # ─── 5) 起 TB ───────────────────────────────────
  step "启动 Thunderbird"
  # 先确保它没在跑——如果在跑，user.js 改动要重启才生效
  if pgrep -x thunderbird >/dev/null 2>&1; then
    echo "  Thunderbird 在运行——为应用 user.js 改动需要重启。先 osascript 让它退出："
    osascript -e 'tell application "Thunderbird" to quit' || true
    # 等它优雅退出
    local i
    i=0
    while [[ $i -lt 10 ]]; do
      pgrep -x thunderbird >/dev/null 2>&1 || break
      sleep 0.5
      i=$((i + 1))
    done
  fi
  open -a Thunderbird
  ok "TB 已启动。如果看不到左侧 Spaces 栏的 'AI 助手' 图标，看一下 Tools → Add-ons 里 ThunderClaw 是不是 enabled"

  printf "\n\033[32m装完了。\033[0m 直接用就行：左侧 Spaces 栏点 'AI 助手' 图标。\n"
}

uninstall_main() {
  step "卸载 ThunderClaw"
  rm -rf "$LIB_DIR"
  rm -f "$WRAPPER"
  local d
  for d in "${NMH_DIRS[@]}"; do
    rm -f "$d/thunderclaw.json"
  done
  ok "native host 已移除"

  if [[ -f "$PROFILES_INI" ]]; then
    local p
    while IFS= read -r p; do
      if [[ -n "$p" ]]; then
        rm -f "$TB_PROFILES_DIR/$p/extensions/$EXT_ID.xpi"
      fi
    done < <(awk '/^\[Profile/{f=1; next} /^\[/{f=0} f && /^Path=/{sub(/^Path=/,""); print}' "$PROFILES_INI")
    ok "扩展已从所有 profile 移除"
  fi

  printf "\n注：留下了 user.js 里那三条 pref——它们对其它未签名扩展也有用，要彻底清自己删 ~/Library/Thunderbird/Profiles/*/user.js 里 thunderclaw 标记下方的行。\n"
}

run_install_with_resolved_version() {
  local raw resolved
  raw="$1"
  resolved=$(resolve_version "$raw")
  if [[ -z "$resolved" ]]; then
    # 兜底 —— resolve_version 内部 exit 应该已经退了，但 $() 子 shell 偶尔不冒泡
    err "resolve_version 返回了空字符串。用具体版本重试：bash -s -- 0.1.21"
    exit 1
  fi
  install_main "$resolved"
}

case "$ARG" in
  install|"")
    run_install_with_resolved_version "${2:-latest}"
    ;;
  uninstall|remove)
    uninstall_main
    ;;
  *)
    # 没匹配 install/uninstall，按 version 处理（用户直接传了 0.1.20 之类的）
    run_install_with_resolved_version "$ARG"
    ;;
esac
