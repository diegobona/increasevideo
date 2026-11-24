# Google 登录与一次性试用

当前规则由 `src/config/pricing.ts` 统一提供：每个 Google 账号一次免费试用，可上传最长 15 秒的视频，由服务端自动截取前 5 秒增强；短于 5 秒时处理全片。最高 720p、强制水印。游客可以浏览公开页面和本地演示，但不能上传、读取云端视频参数、提交增强任务或购买额度。

## 本地配置

在 Google Cloud 创建 **Web application** 类型的 OAuth 客户端，配置同意屏幕；测试模式下添加自己的 Google 账号为测试用户。在本机 `.env.local` 填写：

```dotenv
APP_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="你的客户端 ID"
GOOGLE_CLIENT_SECRET="你的客户端密钥"
```

Google 控制台的 Authorized redirect URIs 添加：

```text
http://localhost:3000/auth/google/callback
```

访问地址、端口和回调必须一致。使用 `127.0.0.1` 时也要修改 `APP_URL` 和 Google 回调地址。线上使用 `https://increasevideoquality.com/auth/google/callback`，并设置对应的 HTTPS `APP_URL`。不要把密钥写入前端环境变量或提交到仓库。

执行迁移并重启服务：

```sh
pnpm db:migrate
pnpm dev
```

Windows 普通终端暂未安装 pnpm 时，已有依赖可用 `npx.cmd prisma migrate dev` 和 `npm.cmd run dev`。新增的 `jose` 已在 `package.json` 和 pnpm lockfile 声明。

Google 官方配置说明：[Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)。

## 身份与额度

- `Account.googleSubject` 唯一，使用 Google 的 `sub`，邮箱变更不会创建第二个试用身份。
- `AuthSession` 存储随机会话令牌的 SHA-256 摘要；浏览器只持有 HttpOnly、SameSite=Lax cookie，HTTPS 下设置 Secure。退出时撤销服务器会话。
- `GoogleAuthFlow` 存储短期、单次使用的 state、PKCE verifier 和 nonce；回调核对浏览器 state，兑换 code，并通过 `jose` 校验 Google 签名、issuer、audience、有效期、nonce 和已验证邮箱。不保存 Google access/refresh token。
- 登录事务创建账号、一次性 `FREE_GRANT` 和会话。同一账号并发登录也只发放一次。消费和失败返还仍走 `CreditLedger`；失败返还原试用额度，不另外发放新试用。
- 为兼容既有业务表，`VideoJob`、`Order`、`CreditLedger` 的 `visitorId` 列在新记录中保存稳定的 `Account.id`。匿名 visitor cookie 仅保留为归因及未登录限流身份。不会根据可修改的访客 cookie 把旧余额归给某个 Google 账号。本地检查没有已付款的旧订单；历史行原样保留。
- 任务和 metadata 使用账号与 IP 双维度限流。换浏览器不能绕过账号次数，换账号也受 IP 限制。Google 授权入口、回调和退出同样限流。
- 首页、登录页、定价、隐私及条款均服务端渲染；登录页 noindex。试用已用完时，上传卡显示 `Trial used` 并转为付费处理。

迁移：`20261121124611_google_account_trial` 只增加登录相关表和索引，保留原订单、视频及 CHECK 约束。

## 验证范围

`pnpm test` 包含真实 SQLite 账本与模拟 Google / fal 响应的集成测试：游客 401、OAuth state 防重放、ID token 校验、同账号重复及并发登录、清 cookie 后余额、5 秒成功、5.01 秒拒绝、第二次试用 402、退出与过期会话，以及原支付和上传流程。

测试日志：`docs/google-auth-tests.txt`。SSR 检查通过 `node scripts/check-ssr.mjs` 验证四个公开页面和首页 Google 登录文案。

未配置 Google 凭据时，登录页明确显示暂未开放。自动测试不代表真实 Google 授权和视频增强已联调；真实处理还需要 R2、FAL_KEY 及免费水印工作流配置。

## 本地验收结果（2026-11-21）

- `prisma migrate dev --name google_account_trial`：成功。
- `pnpm test`：115 passed，0 failed。
- `pnpm lint && pnpm build`：成功。
- 生产服务 `pnpm start` 后 SSR：4/4 passed，输出见 `docs/google-auth-ssr.txt`。
- 直接 POST `/api/upload`、`/api/video/metadata`、`/api/jobs`、`/api/checkout`：游客均返回 `401 AUTH_REQUIRED`。
- Edge 确认首页 Google 登录入口、一次账号试用文案；未配置时点击进入登录暂未开放页面。截图 `docs/google-sign-in.jpg`。任务测试页已关闭，保留用户原有标签页。
- 当前生产预览启动于 `http://127.0.0.1:3000/`。本机尚缺 Google 客户端 ID/密钥，以及之前的 fal 配置；未声称真实 Google 登录或真实视频处理已跑通。

## 真实 Google 登录验收（2026-11-22）

独立项目 increase-video-quality 的 Web OAuth 客户端已创建，凭据已写入本机 .env.local。已用 Edge 完成真实 Google 登录，网站返回已登录状态，数据库产生 1 个账号、1 个会话和 1 次免费试用发放。Google 应用目前为外部测试模式，当前账号已加入测试用户；尚未发布为生产应用。

本机访问地址为 http://localhost:3000。Node 直连 Google 会超时，需要沿用本机已有代理；重新启动命令和完整配置记录见 [Google Console 配置进度](google-console-setup.md)。pnpm lint 与 pnpm build 均通过。

本次仅完成真实登录验证，没有调用付费视频处理，也没有消耗试用额度；视频增强仍需单独配置并验证 fal/R2 工作流。
