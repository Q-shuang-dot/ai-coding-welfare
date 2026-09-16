# -*- coding: utf-8 -*-
"""测试同步到 VS Code 功能"""
import urllib.request
import json

print("=== 测试同步到 VS Code 功能 ===\n")

# 1. 获取当前网关配置
print("1. 获取网关配置...")
try:
    req = urllib.request.Request('http://127.0.0.1:15900/admin/api/config')
    with urllib.request.urlopen(req, timeout=10) as resp:
        config = json.loads(resp.read().decode('utf-8'))
    models = config.get('config', {}).get('models', [])
    print(f"   ✅ 获取到 {len(models)} 个逻辑模型")
    for m in models:
        print(f"      - {m['id']}: {m.get('name', 'N/A')}")
except Exception as e:
    print(f"   ❌ 失败：{e}")
    print("\n请确保网关正在运行：python gateway.py")
    exit(1)

# 2. 调用同步 API
print("\n2. 调用同步 API...")
try:
    payload = json.dumps({'models': models}).encode('utf-8')
    req = urllib.request.Request(
        'http://127.0.0.1:15900/admin/api/sync-vscode',
        data=payload,
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode('utf-8'))
    
    if result.get('ok'):
        added = result.get('added', 0)
        print(f"   ✅ 同步成功！新增了 {added} 个模型到 VS Code")
    else:
        print(f"   ❌ 同步失败：{result.get('error', '未知错误')}")
except Exception as e:
    print(f"   ❌ 失败：{e}")
    exit(1)

print("\n3. 验证 VS Code settings.json...")
import os
vscode_path = os.path.join(os.getenv("APPDATA", ""), "Code", "User", "settings.json")
if os.path.exists(vscode_path):
    # VS Code settings.json 是 JSONC，用 _parse_jsonc 兼容解析
    import re, json as _json
    def _parse_jsonc(content):
        out, i, n = [], 0, len(content)
        in_str = esc = False
        while i < n:
            c = content[i]
            if in_str:
                out.append(c)
                if esc: esc = False
                elif c == '\\': esc = True
                elif c == '"': in_str = False
                i += 1
            elif c == '"':
                in_str = True; out.append(c); i += 1
            elif c == '/' and i + 1 < n:
                if content[i+1] == '/':
                    while i < n and content[i] != '\n': i += 1
                elif content[i+1] == '*':
                    i += 2
                    while i < n-1 and not (content[i]=='*' and content[i+1]=='/'): i += 1
                    i += 2
                else:
                    out.append(c); i += 1
            else:
                out.append(c); i += 1
        settings = _json.loads(re.sub(r',(\s*[}\]])', r'\1', ''.join(out)))
        return settings
    with open(vscode_path, 'r', encoding='utf-8') as f:
        settings = _parse_jsonc(f.read())
    gcmp_models = settings.get('gcmp.compatibleModels', [])
    gw_models = [m for m in gcmp_models if m.get('id', '').startswith('gw-')]
    print(f"   ✅ VS Code 当前有 {len(gw_models)} 个网关模型配置")
    for m in gw_models[-5:]:  # 只显示最后 5 个
        print(f"      - {m['id']}: {m['name']}")
    if len(gw_models) > 5:
        print(f"      ... 还有 {len(gw_models) - 5} 个")
else:
    print(f"   ⚠️  未找到 VS Code settings.json")

print("\n✅ 测试完成！")
print("\n提示：在 VS Code 中打开 settings.json，查看 gcmp.compatibleModels 是否已更新。")
