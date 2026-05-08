#!/usr/bin/env bash
# ThunderClaw 一键 Linux 安装器（v0.3.0+：Go binary，**无 Node 依赖**）。
#
# 一行装：
#   curl -fsSL https://raw.githubusercontent.com/pekinlcc/thunderclaw/main/scripts/install-linux.sh | bash
#
# 锁版：
#   curl -fsSL .../install-linux.sh | bash -s -- 0.3.0
#
# 干的事：
#   1. 探发行版 + 架构
#   2. apt 系（Ubuntu / Debian / Mint）→ 下 .deb，sudo apt install（用 system-wide policies.json）
#   3. 其它发行版 / arm64 → tarball 路径：
#        - 把 host binary 放 ~/.local/share/thunderclaw/
#        - 写 NMH manifest 到 ~/.thunderbird/native-messaging-hosts/
#        - XPI 落 TB profile + user.js 自动启用
#   4. 检测 snap thunderbird → 弹警告（.deb 装得上，但运行时 native messaging 不通）
#
# 卸载：bash -s -- uninstall
set -eo pipefail

REPO="pekinlcc/thunderclaw"
EXT_ID="thunderclaw@pekinlcc.dev"
TB_PROFILES_DIR="$HOME/.thunderbird"
PROFILES_INI="$TB_PROFILES_DIR/profiles.ini"
LIB_DIR="$HOME/.local/share/thunderclaw"

ARG="${1:-install}"

err()  { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }
ok()   { printf "\033[32m✓\033[0m %s\n"  "$*"; }
step() { printf "\n\033[1m==>\033[0m %s\n" "$*"; }

resolve_version() {
  local v
  v="$1"
  if [[ "$v" != "latest" && -n "$v" ]]; then echo "$v"; return; fi
  local r
  r=$(curl -fsSI "https://github.com/$REPO/releases/latest" 2>/dev/null \
    | awk 'tolower($1) == "location:" { print $2 }' \
    | tr -d '\r\n' | sed -n 's|.*/releases/tag/v||p')
  if [[ -n "$r" ]]; then echo "$r"; return; fi
  err "无法解析最新版本——指定版本：bash -s -- 0.3.0"; exit 1
}

detect_arch() {
  case "$(uname -m)" in
    x86_64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) err "不支持的架构：$(uname -m)"; exit 1 ;;
  esac
}

detect_snap_tb() {
  local tb_path real_tb
  tb_path="$(command -v thunderbird 2>/dev/null || true)"
  if [[ -z "$tb_path" ]]; then return 1; fi
  real_tb="$(readlink -f "$tb_path" 2>/dev/null || echo "$tb_path")"
  case "$real_tb" in
    /snap/*|/var/snap/*) return 0 ;;
    *) return 1 ;;
  esac
}

warn_snap_tb() {
  cat >&2 <<'WARN'

⚠️  你的 Thunderbird 是 snap 版（系统级问题）

  Ubuntu 24.04 的 xdg-desktop-portal 没暴露 WebExtensions backend，snap TB
  无法 spawn 我们的 native host —— 扩展会装上但运行时所有 native messaging
  调用都会失败。装完就能看到红色"Native host 版本过旧"的横条。

  推荐先换 Mozilla 官方 tarball 版（10 分钟，邮件账户保留），再装 ThunderClaw。

WARN
}

install_via_deb() {
  local version arch tmp deb_url
  version="$1"
  arch="$2"
  if [[ "$arch" != "amd64" ]]; then
    err "当前 .deb 只支持 amd64。arm64 用 tarball 路径（自动）"
    return 1
  fi
  tmp=$(mktemp -d -t thunderclaw)
  trap "rm -rf '$tmp'" RETURN
  deb_url="https://github.com/$REPO/releases/download/v$version/thunderclaw_${version}_amd64.deb"
  step "下载 .deb：$deb_url"
  curl -fSL --progress-bar -o "$tmp/thunderclaw.deb" "$deb_url" \
    || { err "下载 .deb 失败"; return 1; }
  step "sudo apt install"
  sudo apt-get install -y "$tmp/thunderclaw.deb"
  ok "ThunderClaw v$version 已通过 .deb 安装"
}

# 解析 profiles.ini 找默认 profile
default_profile_path() {
  if [[ ! -f "$PROFILES_INI" ]]; then
    err "找不到 $PROFILES_INI——你需要至少启动过一次 Thunderbird"
    return 1
  fi
  local rel
  # [Install*].Default
  rel=$(awk '
    /^\[Install/ { in_install=1; next }
    /^\[/        { in_install=0 }
    in_install   { if ($0 ~ /^Default=/) { sub(/^Default=/,""); print; exit } }
  ' "$PROFILES_INI")
  if [[ -n "$rel" ]]; then echo "$TB_PROFILES_DIR/$rel"; return; fi
  # [Profile*].Default=1
  rel=$(awk '
    /^\[Profile/  { p=""; d=0; in_p=1; next }
    /^\[/         { if (in_p && d==1) { print p; in_p=0; exit } in_p=0 }
    in_p && /^Path=/     { sub(/^Path=/,""); p=$0 }
    in_p && /^Default=1/ { d=1 }
    END           { if (in_p && d==1) print p }
  ' "$PROFILES_INI")
  if [[ -n "$rel" ]]; then echo "$TB_PROFILES_DIR/$rel"; return; fi
  # 第一个 [Profile*]
  rel=$(awk '/^\[Profile/{f=1; next} /^\[/{f=0} f && /^Path=/{sub(/^Path=/,""); print; exit}' "$PROFILES_INI")
  if [[ -z "$rel" ]]; then err "解析 $PROFILES_INI 失败"; return 1; fi
  echo "$TB_PROFILES_DIR/$rel"
}

install_via_tarball() {
  local version arch tmp host_url xpi_url profile_dir
  version="$1"
  arch="$2"
  tmp=$(mktemp -d -t thunderclaw)
  trap "rm -rf '$tmp'" RETURN
  host_url="https://github.com/$REPO/releases/download/v$version/thunderclaw-native-host-v$version.tar.gz"
  step "下载 native host tarball"
  curl -fSL --progress-bar -o "$tmp/host.tar.gz" "$host_url" \
    || { err "下载失败：$host_url"; return 1; }
  tar -xzf "$tmp/host.tar.gz" -C "$tmp"

  # 把 binary 放进 lib_dir
  local host_bin_src="$tmp/thunderclaw-native-host-v$version/host-bin/linux-$arch/thunderclaw-host"
  if [[ ! -f "$host_bin_src" ]]; then
    err "找不到 linux-$arch binary"; return 1
  fi
  mkdir -p "$LIB_DIR"
  cp "$host_bin_src" "$LIB_DIR/thunderclaw-host"
  chmod +x "$LIB_DIR/thunderclaw-host"
  ok "native host → $LIB_DIR/thunderclaw-host"

  # NMH manifest（Linux 多个候选位置都铺一份）
  local manifest
  manifest=$(printf '{"name":"thunderclaw","description":"ThunderClaw native messaging host","path":"%s","type":"stdio","allowed_extensions":["%s"]}\n' \
    "$LIB_DIR/thunderclaw-host" "$EXT_ID")
  local d
  for d in \
    "$HOME/.thunderbird/native-messaging-hosts" \
    "$HOME/.mozilla/native-messaging-hosts"; do
    mkdir -p "$d"
    printf '%s' "$manifest" > "$d/thunderclaw.json"
    ok "NMH manifest → $d/thunderclaw.json"
  done

  # XPI 下下来
  step "下载 XPI"
  xpi_url="https://github.com/$REPO/releases/download/v$version/thunderclaw-$version.xpi"
  curl -fSL --progress-bar -o "$tmp/thunderclaw.xpi" "$xpi_url" \
    || { err "下载 XPI 失败"; return 1; }

  # 落 TB profile
  profile_dir=$(default_profile_path)
  step "目标 TB profile：$profile_dir"
  if [[ ! -d "$profile_dir" ]]; then
    err "profile 目录不存在——先启动一次 TB"; return 1
  fi
  mkdir -p "$profile_dir/extensions"
  cp "$tmp/thunderclaw.xpi" "$profile_dir/extensions/$EXT_ID.xpi"
  ok "XPI → $profile_dir/extensions/$EXT_ID.xpi"

  # user.js 自动启用 + 关签名校验
  local user_js marker
  user_js="$profile_dir/user.js"
  marker="// thunderclaw:auto-enable"
  if ! grep -q "$marker" "$user_js" 2>/dev/null; then
    printf '\n%s  # 由 install-linux.sh 写入\nuser_pref("extensions.autoDisableScopes", 0);\nuser_pref("extensions.enabledScopes", 15);\nuser_pref("xpinstall.signatures.required", false);\n' \
      "$marker" >> "$user_js"
    ok "user.js auto-enable prefs 已加"
  fi
}

install_main() {
  local version arch
  version="$1"
  arch=$(detect_arch)
  step "Linux 一键装 ThunderClaw v$version (arch=$arch)"

  if detect_snap_tb; then
    warn_snap_tb
    read -r -p "继续吗？(y/N) " yn
    [[ "$yn" =~ ^[yY] ]] || { echo "取消"; exit 0; }
  fi

  # 优先 .deb（apt 系 amd64）
  if [[ "$arch" == "amd64" ]] && command -v apt-get >/dev/null 2>&1; then
    if install_via_deb "$version" "$arch"; then
      ok "完成。重启 Thunderbird 即可看到 AI 助手 图标"
      return
    fi
    err ".deb 安装失败，回退到 tarball 路径"
  fi

  # 兜底 tarball
  install_via_tarball "$version" "$arch"
  ok "完成。重启 Thunderbird 即可看到 AI 助手 图标"
}

uninstall_main() {
  step "卸载 ThunderClaw"
  if dpkg -l | grep -q '^ii.*thunderclaw '; then
    sudo apt-get remove -y thunderclaw
    ok ".deb 卸了"
  fi
  rm -rf "$LIB_DIR"
  for d in \
    "$HOME/.thunderbird/native-messaging-hosts" \
    "$HOME/.mozilla/native-messaging-hosts"; do
    rm -f "$d/thunderclaw.json"
  done
  if [[ -f "$PROFILES_INI" ]]; then
    while IFS= read -r p; do
      [[ -n "$p" ]] && rm -f "$TB_PROFILES_DIR/$p/extensions/$EXT_ID.xpi"
    done < <(awk '/^\[Profile/{f=1; next} /^\[/{f=0} f && /^Path=/{sub(/^Path=/,""); print}' "$PROFILES_INI")
  fi
  ok "全部移除"
}

case "$ARG" in
  install|"")    install_main "$(resolve_version "${2:-latest}")" ;;
  uninstall|remove) uninstall_main ;;
  *)             install_main "$(resolve_version "$ARG")" ;;
esac
