import json

with open(r'd:\个人项目\gcmp-welfare-temp\data\sites.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Find position after supxh
idx = [s['id'] for s in data['sites']].index('supxh')

api456 = {
    "id": "api456",
    "name": "api456.me",
    "subtitle": "New API 中转站 · 注册送$20，每日签到，支持 OpenAI 协议",
    "recommended": False,
    "credits": {
        "signup": 20,
        "invite": 20,
        "dailyCheckin": 10,
        "approx": False
    },
    "signupUrl": "https://api456.me/register?aff=zmza",
    "inviteCode": "zmza",
    "homeUrl": "https://api456.me",
    "docsUrl": None,
    "statusApi": "https://api456.me/api/status",
    "pricingApi": None,
    "mirrors": [],
    "tags": [
        "New API",
        "中转站",
        "免费额度",
        "每日签到",
        "OpenAI 兼容"
    ],
    "highlights": [
        "从本页邀请链接注册即得 $20 额度，邀请码 zmza 可再得 $20，首日合计 $30",
        "每日签到支持，长期白嫖有续命来源",
        "OpenAI 兼容协议，Claude Code / Codex / Cursor 都能直连",
        "定价页免登录可读（/api/pricing 公开返回）"
    ],
    "endpoints": {
        "anthropic": None,
        "openai": "https://api456.me/v1"
    },
    "modelsNote": "模型清单与价格需登录后在控制台查看（/api/pricing 匿名请求需登录），本页不列模型表。",
    "register": {
        "methods": [
            "GitHub OAuth"
        ],
        "requirements": [
            "从本页邀请链接进入注册（带 ?aff=zmza），邀请额度才会发放",
            "只能用 GitHub 授权登录",
            "注册需要邮箱验证码并有人机校验"
        ]
    },
    "earnMore": [
        "每日签到领额度（登录后台操作）",
        "邀请他人注册，邀请双方各得 $20"
    ],
    "caveats": [
        "额度数字站点公开接口不暴露，注册后进后台核对实际到账",
        "站点挂在 Cloudflare 后面，匿名探测可能被 WAF 拦，属正常防护",
        "上游为第三方中转，模型与倍率随公告调整，别当稳定生产通道用"
    ],
    "community": []
}

data['sites'].insert(idx + 1, api456)

with open(r'd:\个人项目\gcmp-welfare-temp\data\sites.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'Added api456 at position {idx+2}, total sites: {len(data["sites"])}')
print('IDs:', [s['id'] for s in data['sites']])
