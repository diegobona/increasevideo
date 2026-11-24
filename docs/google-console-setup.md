# Google Console 配置进度

## Cloudflare 线上回调（2026-11-23）

已在原本站 OAuth 客户端增加并保存 `https://increasevideoquality.zw83716.workers.dev/auth/google/callback`，保留原有本地和正式域名回调。Google 页面确认“OAuth 客户端已保存”，截图为 `cloudflare-google-callback.jpg`。线上授权入口已验证返回 303，真实登录留给用户测试；应用仍处于测试模式。

日期：2026-11-22。

- 已创建独立 Google Cloud 项目：Increase Video Quality。
- 项目 ID：increase-video-quality。
- 原项目 gen-lang-client-0057698115 的其他 OAuth 客户端与品牌设置未修改。
- 已保存应用名称 Increase Video Quality、支持邮箱、联系邮箱，以及首页、隐私政策、服务条款链接和授权域名 increasevideoquality.com。
- Web OAuth 客户端已创建：Increase Video Quality Web；客户端 ID 和密钥已写入本机 .env.local，未写入文档。
- 发布状态：外部 / 测试；已加入当前 Google 账号为测试用户。尚未发布为正式生产应用。
- 管理地址：https://console.cloud.google.com/auth/clients?project=increase-video-quality

已创建的 Web 客户端名称：Increase Video Quality Web。
已保存的回调地址：

```text
http://localhost:3000/auth/google/callback
http://127.0.0.1:3000/auth/google/callback
https://increasevideoquality.com/auth/google/callback
```

现有代码仅请求 openid、email、profile。密钥已保存到被 .gitignore 排除的本机 .env.local；APP_URL 为 http://localhost:3000。

## 2026-11-22 项目可见性复核

- 用户当时查看的是 Gemini API 项目中的客户端列表。
- 已在 Edge 项目选择器搜索到 Increase Video Quality（ID：increase-video-quality），并切换成功。
- 当前独立项目的客户端页面显示“没有要显示的 OAuth 客户端”；项目创建完成，OAuth 客户端配置尚未完成。
- 项目入口：https://console.cloud.google.com/auth/clients?project=increase-video-quality
- 沿用用户原有 Google Cloud 标签页，未新开标签页，未修改其他项目。

## 2026-11-22 创建和真实登录验收

- 用户明确同意继续创建后，Google 返回“OAuth 客户端已创建”，客户端列表出现 Increase Video Quality Web。
- 品牌页面返回“已保存品牌更改！”，受众页面显示 1 个测试用户。
- pnpm lint 通过；pnpm build 通过（初次构建因沙箱目录权限失败，正常权限重试成功）。
- 本地授权入口返回 303，目标为 https://accounts.google.com/o/oauth2/v2/auth，回调为 http://localhost:3000/auth/google/callback，scope 为 openid email profile，PKCE 为 S256。
- Edge 真实登录成功，返回 http://localhost:3000/#upload，显示 Signed in as、1 free job credits、Account trial: 1 use · up to 5 seconds。
- 本地数据库只读核对：Account 1 条、AuthSession 1 条、FREE_GRANT 1 条。没有提交视频或消耗试用。
- 截图：google-login-success.png。临时登录测试标签页已关闭，保留用户原有 Google Cloud 标签页。
- 本机 Node 直接请求 Google 超时，使用用户现有系统代理 127.0.0.1:7888 后证书接口返回 200，真实登录回调成功。当前本地服务已带代理启动。

## 本机重新启动

本机 Google 回调需要沿用现有代理。在 PowerShell 的同一窗口中执行（代理软件需保持运行；未修改 Windows 代理设置）：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7888"
$env:HTTPS_PROXY = "http://127.0.0.1:7888"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:NODE_USE_ENV_PROXY = "1"
npm.cmd run dev
```

生产构建可使用 npm.cmd run start。访问 http://localhost:3000；不要使用其他端口而不更新 APP_URL 和回调地址。以上代理是本机开发设置，不应复制到 Cloudflare 生产环境。当前机器已验证 Node.js 24.14.0 支持此代理开关。
