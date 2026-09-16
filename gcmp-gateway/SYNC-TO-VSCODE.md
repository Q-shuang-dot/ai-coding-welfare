# 同步到 VS Code 功能

## 功能说明

在管理页顶栏新增了 **"🔄 同步到 VS Code"** 按钮，点击后可以:

1. 自动读取当前网关配置的所有逻辑模型
2. 生成 VS Code GCMP 插件兼容的模型配置
3. 直接写入 VS Code 的 `settings.json` 文件
4. 智能去重：已存在的模型不会重复添加

## 使用步骤

### 方法一：通过管理页 (推荐)

1. 启动网关：`start-gateway.bat`
2. 打开管理页：http://127.0.0.1:15900/admin/
3. 在逻辑模型页面添加/修改你的模型配置
4. 点击顶栏的 **"💾 保存配置"** 保存到网关
5. 点击顶栏的 **"🔄 同步到 VS Code"** 同步到 VS Code
6. 在 VS Code 中重新加载窗口或重启 VS Code

### 方法二：通过测试脚本

```bash
# 确保网关正在运行
python test_sync_vscode.py
```

## 生成的配置格式

同步功能会自动生成如下配置:

```json
{
  "id": "gw-opus-5",
  "name": "Opus 5",
  "provider": "gateway",
  "baseUrl": "http://127.0.0.1:15900/v1",
  "model": "opus-5",
  "sdkMode": "openai-sse",
  "proxy": "noproxy",
  "maxInputTokens": 200000,
  "maxOutputTokens": 16384,
  "capabilities": {
    "toolCalling": true,
    "imageInput": true
  }
}
```

### 配置规则

- **模型 ID**: 自动添加 `gw-` 前缀 (如 `opus-5` → `gw-opus-5`)
- **工具调用**: 默认启用 `toolCalling: true`
- **视觉能力**: 如果模型的路由中有支持图片的上游，自动启用 `imageInput: true`
- **其他配置**: 自动继承网关配置的 `maxInputTokens` 和 `maxOutputTokens`

## 注意事项

1. **必须先保存网关配置**: 同步功能读取的是当前运行时的配置，如果只改了 `config.json` 但没在管理页保存，需要同步的内容不会包含新修改

2. **不会删除已有模型**: 同步功能只会添加新模型，不会删除 VS Code 中已有的模型配置

3. **模型更新**: 如果想更新已有模型的配置 (如修改 maxTokens)，需要手动在 VS Code 中修改，或先手动删除该模型再重新同步

4. **VS Code 需要重启**: 同步后需要重新加载 VS Code 窗口才能使新模型生效
   - 快捷键：`Ctrl+Shift+P` → "Reload Window"

## 技术实现

- **API 端点**: `POST /admin/api/sync-vscode`
- **目标文件**: `%APPDATA%\Code\User\settings.json`
- **配置键**: `gcmp.compatibleModels`

## 故障排查

### 同步失败："未找到 VS Code settings.json"

- 确保已安装 VS Code
- 确保 VS Code 至少启动过一次 (会创建 settings.json)

### 同步成功但 VS Code 没有新模型

- 在 VS Code 中检查 `settings.json` 确认文件已更新
- 重新加载 VS Code 窗口
- 检查模型 ID 是否已存在 (已存在的不会重复添加)

### 手动触发同步

也可以直接用 curl 测试:

```bash
curl -X POST http://127.0.0.1:15900/admin/api/sync-vscode \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "models": [
    {"id": "opus-5", "name": "Opus 5", "maxInputTokens": 200000}
  ]
}
EOF
```
