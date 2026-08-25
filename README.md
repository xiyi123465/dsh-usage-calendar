# dsh-usage-calendar

DeepSeek Harness（dsh web）持久插件：侧边栏底部常驻显示 **DeepSeek 账户余额**，点击打开**日历面板**，按天查看 **花费（估算）、token 用量、缓存命中率**，点击日期查看分模型明细。profile-bundle 安装机制，重启后依然存在。

## 功能

- 💰 **账户余额**：通过 DeepSeek 官方 `GET {baseURL}/user/balance` 接口查询（Node fetch + Bearer 认证），1 秒缓存，界面每 1 秒自动刷新，可手动强制刷新
- 📅 **日历视图**：按天聚合本机全部会话（含历史会话与已持久化会话）的 token 用量；月度网格显示每天花费、tokens、缓存命中率，深浅色表示花费高低；点击日期查看分模型明细；支持月份切换与"今天"
- 🧮 **花费估算**：按 DeepSeek 公开标价计算（USD/百万 tokens；reasoner 与 chat 两档），余额币种为 CNY 时按 ≈7.1 折算显示
- 🎯 **缓存命中率**：`cacheRead / (input + cacheRead + cacheWrite)`（提示词侧）
- 🔒 **本地统计**：数据来源仅为本机会话事件日志（`assistant/chunk` usage 样本），不上传任何数据；接口仅接受本机回环请求

## 安装

### 方式 A：profile bundle（本机采用，与 dsh-usage-stats 相同）

1. 将本仓库放到 `$DSH_HOME/vendor/dsh-usage-calendar`
2. 编辑 `$DSH_HOME/profiles/web/package.json`：
   - `dependencies` 增加 `"dsh-usage-calendar": "file:../../vendor/dsh-usage-calendar"`
   - `dsh.profile.bundles` 增加 `"dsh-usage-calendar"`
3. 在 `$DSH_HOME/profiles/web` 执行 `pnpm install`
4. 重启 dsh web，浏览器硬刷新

### 方式 B：npx 安装器（分发用）

```sh
npx --yes github:xiyi123465/dsh-usage-calendar
```

安装器把包复制到 `$DSH_HOME/profiles/node_modules/dsh-usage-calendar`，并把补丁写入 `$DSH_HOME/profiles/web/cordis.patch.yml`。重启 dsh web 后生效。

选项：`--check`（校验安装）、`--dry-run`（预览）、`--no-enable`（只复制文件不改补丁）、`--help`。可用 `DSH_HOME` 环境变量覆盖安装目录。

### 方式 C：ZIP 离线安装（无需 npx / 网络）

1. 将 zip 解压到 `$DSH_HOME/vendor/dsh-usage-calendar`（Windows PowerShell）：

   ```powershell
   Expand-Archive .\dsh-usage-calendar-0.1.2.zip -DestinationPath $env:USERPROFILE\.dsh\vendor
   ```

2. 运行安装器并重启 dsh web：

   ```powershell
   node $env:USERPROFILE\.dsh\vendor\dsh-usage-calendar\scripts\install.mjs
   ```

## 配置

- **API Key**：读取 `llm-deepseek` 设置命名空间的 `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`），通过凭据服务在请求时解析 —— web 端「模型」页写入的 key 即可直接使用，插件不存储密钥
- **baseURL**：默认 `https://api.deepseek.com`；使用兼容中转时可在 `llm-deepseek` 设置中指定
- **定价表**：`lib/usage.js` 中的 `PRICING`（chat 与 reasoner 两档公开标价），花费为估算值，界面已标注

## 开发

```sh
pnpm check   # 语法检查（node --check 全部文件）
pnpm smoke   # 冒烟测试：合成事件折叠 + 桩服务启动 + 余额处理器
```

冒烟测试请将 `DSH_HOME` 指向临时目录，避免写入真实用量缓存：

```powershell
$env:DSH_HOME = "$env:TEMP\dsh-smoke"; node scripts/smoke-host.mjs
```

## 与 dsh-usage-stats 的关系

两个插件互不依赖、可并存。`dsh-usage-stats` 提供热力图与多供应商余额；本插件提供余额 + 日历形式的花费/token/缓存命中率视图。
