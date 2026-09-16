#!/usr/bin/env bash
# 交互式为 Claude Code 配置福利站接入参数（macOS / Linux）。
# 用法： bash scripts/quickstart.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITES="$ROOT/data/sites.json"
LIVE="$ROOT/data/live.json"

command -v node >/dev/null 2>&1 || { echo "需要 Node.js 18+，请先安装：https://nodejs.org"; exit 1; }
[ -f "$SITES" ] || { echo "找不到 $SITES"; exit 1; }

echo "可选站点（只列出提供 Anthropic 兼容 Base URL、能直连 Claude Code 的站点）："
node -e '
const fs=require("fs");
const {sites}=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
sites.filter(s=>s.endpoints&&s.endpoints.anthropic).forEach((s,i)=>console.log(`  ${i+1}) ${s.name} — ${s.subtitle}`));
' "$SITES"

read -r -p "选择站点编号 [1]: " IDX
IDX="${IDX:-1}"

read -r -a CFG <<< "$(node -e '
const fs=require("fs");
const {sites}=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
let live={sites:[]}; try{live=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));}catch{}
const list=sites.filter(s=>s.endpoints&&s.endpoints.anthropic);
const s=list[Number(process.argv[3])-1];
if(!s){console.error("编号无效");process.exit(1);}
const snap=(live.sites||[]).find(x=>x.id===s.id);
const model=snap?.defaults?.claude || "claude-opus-4-8";
process.stdout.write([s.name,s.endpoints.anthropic,model,s.signupUrl].join(" "));
' "$SITES" "$LIVE" "$IDX")"

NAME="${CFG[0]}"; BASE="${CFG[1]}"; MODEL="${CFG[2]}"; SIGNUP="${CFG[3]}"

echo
echo "站点：$NAME"
echo "还没有账号？先注册领额度：$SIGNUP"
echo
read -r -s -p "粘贴该站后台创建的 API Key: " KEY; echo
[ -n "$KEY" ] || { echo "Key 不能为空"; exit 1; }

read -r -p "模型名 [$MODEL]: " M; MODEL="${M:-$MODEL}"

SNIPPET=$(cat <<EOF

# >>> ai-coding-welfare: $NAME >>>
export ANTHROPIC_BASE_URL="$BASE"
export ANTHROPIC_AUTH_TOKEN="$KEY"
export ANTHROPIC_MODEL="$MODEL"
# <<< ai-coding-welfare: $NAME <<<
EOF
)

# 屏幕上只显示打码后的 Key，避免 Key 出现在终端回滚缓冲区里
MASK="${KEY:0:4}****${KEY: -4}"
PREVIEW="${SNIPPET/$KEY/$MASK}"

case "${SHELL:-}" in
  */zsh) RC="$HOME/.zshrc" ;;
  */fish) RC="" ;;
  *) RC="$HOME/.bashrc" ;;
esac

echo
echo "将写入以下配置（Key 已打码显示）："
echo "$PREVIEW"
echo
if [ -n "$RC" ]; then
  read -r -p "追加到 $RC ？[y/N] " OK
  if [[ "${OK:-N}" =~ ^[Yy]$ ]]; then
    printf '%s\n' "$SNIPPET" >> "$RC"
    echo "已写入 $RC，执行 source $RC 生效。"
  else
    echo "已跳过写入，可自行复制上面的内容。"
  fi
else
  echo "检测到 fish shell，请手动用 set -gx 设置以上三个变量。"
fi

echo
echo "本次会话立即生效："
echo "  export ANTHROPIC_BASE_URL=\"$BASE\" ANTHROPIC_AUTH_TOKEN=\"<你的Key>\" ANTHROPIC_MODEL=\"$MODEL\""
echo "然后运行： claude"
