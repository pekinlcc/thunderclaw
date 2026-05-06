#!/usr/bin/env bash
# 把 ThunderClaw 在本机 Thunderbird profile 里的痕迹清干净，
# 让下次启动 TB 像首次一样：要重新拖 XPI、重新选 CLI、重新填自我介绍。
#
# 不动：邮件数据、通讯录、日历、native messaging host、user.js 里的开发态 pref。

set -e

PROFILE="$HOME/.thunderbird/d4dmpaut.default"
EXT_ID="thunderclaw@pekinlcc.dev"

if [[ ! -d "$PROFILE" ]]; then
  echo "✗ profile not found: $PROFILE"
  exit 1
fi

# 1) 检查 TB 是不是还在跑——是的话拒绝继续，避免破坏正在被锁的文件
if pgrep -af "/opt/thunderbird/thunderbird( |$)" >/dev/null 2>&1; then
  echo "✗ Thunderbird 还在运行，请先关掉再跑这个脚本。"
  exit 2
fi

echo "→ Resetting ThunderClaw state in $PROFILE …"

# 2) 删 XPI
if [[ -f "$PROFILE/extensions/$EXT_ID.xpi" ]]; then
  rm -f "$PROFILE/extensions/$EXT_ID.xpi"
  echo "  ✓ removed extension XPI"
fi

# 3) 删扩展的 IDB / WebStorage
for d in "$PROFILE"/storage/default/moz-extension+++* \
         "$PROFILE"/storage/permanent/moz-extension+++* \
         "$PROFILE"/storage/temporary/moz-extension+++*; do
  if [[ -d "$d" ]]; then
    rm -rf "$d"
    echo "  ✓ removed storage: ${d##*/}"
  fi
done

# 4) 删 addon 启动缓存（强制 TB 下次启动重新发现扩展）
rm -f "$PROFILE/addonStartup.json.lz4"
echo "  ✓ removed addonStartup cache"

# 5) 删 stale lock（如果上次崩掉留下的）
rm -f "$PROFILE/lock" "$PROFILE/.parentlock"

# 6) 从 prefs.js 里抹掉 thunderclaw 相关条目（UUID、IDB 迁移标记）
#    不全删 webextensions.uuids，那样会动到其它扩展；只删行级条目
if [[ -f "$PROFILE/prefs.js" ]]; then
  cp "$PROFILE/prefs.js" "$PROFILE/prefs.js.tc-backup"
  # 删 ExtensionStorageIDB.migrated.thunderclaw* 这一行
  sed -i '/ExtensionStorageIDB\.migrated\.thunderclaw/d' "$PROFILE/prefs.js"
  echo "  ✓ pruned thunderclaw prefs (backup → prefs.js.tc-backup)"
fi

echo ""
echo "✓ Done. 下一步："
echo "  1) 启动 Thunderbird（命令: thunderbird-tc，或 GNOME 搜 'ThunderClaw'）"
echo "  2) 菜单 → 附加组件和主题 → 齿轮图标 → 从文件安装附加组件"
echo "  3) 选 dist/release/thunderclaw-x.y.z.xpi"
echo "  4) 在 AI 助手空间从 CLI Picker 开始重新走一遍"
