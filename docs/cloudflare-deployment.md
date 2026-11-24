# Cloudflare 部署

用户于 2026-11-23 批准 Workers + D1 + R2，保留 SSR，替代原 Pages 约定。

## 资源

- 正式应用：https://increasevideoquality.com
- 备用入口：https://increasevideoquality.zw83716.workers.dev
- SSR Worker：`increasevideoquality`，vinext 适配现有 App Router；本地 Next.js 工作流不变。
- D1：`increasevideoquality-db`，ID `b9f9bdba-7964-432d-a186-46793967dd42`。
- R2：沿用私有 `video-input`，保留原 CORS 来源并添加 Workers 域名。
- 正式桶规则 `IVQ-Originals-7d` 清理 `increasevideoquality/originals/` 下的原片和裁剪片段，`IVQ-Results-30d` 清理 `increasevideoquality/results/` 下的成片。使用 `pnpm exec wrangler r2 bucket lifecycle list video-input --config cloudflare/database.jsonc` 核对。旧的共用 `uploads/` 目录不在这两条规则内。
- FFmpeg：`increasevideoquality-video` + `VideoContainer`，仅 Service Binding 访问，公网路由关闭；最多一个 basic 实例，闲置一分钟休眠。
- 应用版本：`ee1e5f1b-4af0-4be3-8568-a2239210ba63`；视频服务版本：`ece248d7-a7c7-49d3-86d1-8414be4ff012`。
- 容器应用 ID：`a0308038-d4bf-449c-8d90-06eaeeadb0a9`。

## 数据与密钥

首次上线保留原有 1 个账号、4 个任务、8 条额度账本；没有订单和归因记录。旧本地登录会话不迁移，需要在新域名重新登录。没有重置或消耗试用额度。

生产使用 `PrismaD1` 读取。涉及余额的写入通过 D1 `batch()` 原子提交，并用 `AtomicGuard` 和业务表触发器检测并发变化；不依赖 Prisma D1 不支持的交互式事务。各 API 的限流写入也使用 D1 原子批处理。

应用 Secrets：`FAL_KEY`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`VIDEO_WORKER_KEY`。容器只收到最后一个密钥和 R2 存储位置标识，不能直接访问 Google、fal 或 R2 凭据。

`node scripts/prepare-cloudflare-secrets.mjs` 从本机 `.env.local` 生成被忽略的 `.wrangler/deployment/*-secrets.json`。这些文件包含明文部署输入，禁止提交或分享；Cloudflare 保存为 Worker Secrets。部署工具只在进程环境中复用现有 Wrangler 登录，不打印令牌。

## 后续发布

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm build
pnpm build:vinext
node scripts/prepare-cloudflare-secrets.mjs
pnpm exec wrangler d1 migrations apply increasevideoquality-db --remote --config cloudflare/database.jsonc
pnpm exec wrangler secret bulk .wrangler/deployment/video-secrets.json --config cloudflare/video-worker.jsonc
pnpm exec wrangler deploy --config cloudflare/video-worker.jsonc
node scripts/deploy-cloudflare.mjs
node scripts/check-ssr.mjs --base-url https://increasevideoquality.com
node scripts/check-cloudflare.mjs https://increasevideoquality.com
```

先发布视频服务，再发布有服务绑定的应用。Docker Desktop 需要运行；若本机代理导致 Docker 内下载失败，构建时传递 Docker 的 `HTTP_PROXY` / `HTTPS_PROXY` build args。不要将代理写进生产容器环境。

未来数据库变更新增 `cloudflare/migrations/` 文件，不修改已上线的 `0001_initial.sql`。`prepare-d1.mjs` 仅用于初始结构，`export-d1-data.mjs` 仅用于首次迁入本地业务记录，普通发布不要重跑导入。

## 验收

### 2026-11-24 PVUV 统计接入

- 用户确认数据范围后授权上线；根 layout 加入 PVUV 官方 defer 脚本，站点 ID `KqU9nfVL`。隐私页同步说明采集用途，排除私人结果、登录、支付、认证路由，并关闭自动下载事件。
- lint、Next.js/Workers 构建通过；线上三页脚本检查通过，SSR 11/11 通过。
- Edge 实际访问首页并点击 Video upscaler 后，看板收到 1 位访客、1 次会话、2 次浏览量，两条页面路径各 1 次。说明与截图见 `pvuv-integration.md`、`pvuv-dashboard-live.jpg`。

### 2026-11-24 首页 AI Video Enhancer 文案

- Title 按用户指定改为 `Increase Video Quality Free Trial | AI Video Enhancer up to 4K`（62 字符），输出上限仍引用 pricing 配置；共享 Open Graph 标题随之同步。
- H1 保留 `Increase Video Quality`。How it works 第二步首句包含 `video quality enhancer`，第三步首句包含 `enhance video quality online`。description、H2/H3、样式及其余内容不变。
- lint、Next.js 与 Workers 构建通过；curl 首页 HTTP 200，Title/H1/步骤首句和首页 SSR/SEO 检查通过，见 `home-enhancer-check.txt`。

### 2026-11-24 首页内链补充

- 页头与全站页脚新增 Video upscaler，首页示例介绍加指南链接；首页原始 HTML 共 3 条 `/video-upscaler` 链接。
- 四张场景卡保留；四个场景内页在首页各有 2 条链接，使用不同的自然锚文本。没有修改 CSS、标题文案或视频功能。
- lint、Next.js/Workers 构建通过，线上 SSR 11/11。源码链接计数见 `home-links-check.txt`，说明与 GSC 凭证见 `home-links-2026-11-24.md`。
- GSC 实时测试于 2026-11-24 00:33:50 抓取成功，允许抓取、允许编入索引，canonical 正确。正式 Google 索引报告当时尚无上次抓取时间，不能把实时检查工具记录当作正式 Googlebot 索引记录。

### 2026-11-24 主域名索引与跳转检查

- 主站 11 页的 canonical、og:url 与 sitemap 均为正式 HTTPS 域名，HTML 无 workers.dev 链接。
- Workers 预览页由 middleware 返回 `X-Robots-Tag: noindex, follow`；静态资源由 `public/_headers` 对预览主机设置同一规则。主站不含 noindex。
- `scripts/check-domain-indexing.mjs` 使用 curl GET 检查 11 页、5 个新增页面的斜杠变体、HTTP → HTTPS、robots、sitemap 及预览 noindex；全部通过，见 `domain-indexing-check.txt`。
- 相关测试 10/10、lint、Next.js/Workers 构建通过；线上 SSR 11/11，见 `domain-indexing-ssr.txt`。
- GSC 已通过新增根域 TXT 完成域名验证；sitemap 提交成功，已发现 11 个网页。保留验证 TXT，避免失去所有权验证。
- 首页与 Video Upscaler 页的收录请求均被 Google 接受，显示已加入优先抓取队列；实际收录尚待处理。详情和截图见 `domain-indexing-2026-11-24.md`。

### 2026-11-24 品牌图标更新

- 统一各页导航与页脚 Logo、分享卡片；新增 SVG/ICO favicon 和 Apple touch icon。
- lint、Next.js/Workers 构建通过；线上资源均为 200，SSR 11/11。详见 `brand/README.md`。

### 正式域名绑定

- Spaceship 已配置 `ada.ns.cloudflare.com`、`rick.ns.cloudflare.com`；Cloudflare zone 为 active，DNSSEC 显示成功。
- 通过 `increasevideoquality.com/*` 全路径 Worker 路由提供应用，保留现有代理 DNS；配置已写入 `cloudflare.config.ts`。
- `APP_URL` 为正式域名，Google 既有正式回调与品牌链接、R2 既有正式来源均已核对。
- HTTPS 证书有效，HTTP 301 跳转 HTTPS；正式首页及备用首页均为 200。
- 正式域名 SSR 11/11、上线接口检查通过，输出见 `domain-live-ssr.txt` 和 `domain-live-smoke.txt`；详情见 `domain-binding.md`。

### 2026-11-23 结果页功能更新

- 已发布结果页继续优化、上下文推荐与行为统计，以及此前的公开内容页修改。
- 生产 D1 已应用 `0002_result_engagement.sql`；无待执行迁移。仅新增字段和索引。
- Workers 使用同一 schema 的 `clientWorkerd`（`runtime = "workerd"`）生成客户端，静态导入查询编译器 WASM。Node 客户端保留给本地 Next.js 和测试。修复了生产查询时动态编译 WASM 导致的 CompileError/500。
- `pnpm lint`、`pnpm build`、Workers 构建、Cloudflare TypeScript 检查通过；完整测试 170/170。
- 最终版本公开页面 SSR 11/11：`result-extension-live-ssr.txt`。
- 最终版本上线检查：`result-extension-live-smoke.txt`。任务查询和新增埋点接口对不存在的任务返回 403；结果页对无效合成 cookie 返回 404。没有调用真实视频处理或扣费。
- 自动审批拒绝了读取现有生产任务 ownerToken 的检查（私有访问凭据），因此本次线上验收未访问已有私有结果；使用公开页面、无凭据接口及合成无效 cookie 验证。未绕过该限制。
- 迁移依据：[Cloudflare D1 migrations](https://developers.cloudflare.com/workers/wrangler/commands/d1/#d1-migrations-apply)。

### 首次部署记录

- D1 适配器、并发扣费、幂等退款、Google 登录、免费/付费任务及 Stripe 模拟流程：65/65 通过，见 `cloudflare-tests.txt`。
- 线上四个公开页面 SSR：4/4 通过，正文、FAQ、canonical、Open Graph、JSON-LD 检查见 `cloudflare-ssr.txt`。
- 登录页、robots、sitemap、llms、分享图片、示例视频返回 200；错误结果页 404；匿名任务/metadata 返回 401；Google 授权入口 303 且回调正确，见 `cloudflare-smoke.txt`。
- Edge 已确认首页布局及双视频播放，无浏览器控制台错误，截图 `cloudflare-home.jpg`。任务标签页已关闭。
- 私有视频服务通过远程 Service Binding 返回 `HTTP 200`、`{"ok":true,"data":{"ready":true}}`，检查包含 FFmpeg、FFprobe 和字体就绪状态，见 `cloudflare-video-health.txt`。检查器只监听本机，仅能访问 `/health`，没有处理视频或调用 fal。
- `pnpm lint && pnpm build`、Cloudflare TypeScript 检查通过；Workers 构建和发布成功。

按用户要求，没有提交真实视频到 fal，也没有进行真实登录/增强/支付测试。

## 仍需配置

- Google OAuth 正式回调为 `https://increasevideoquality.com/auth/google/callback`，保留原 Workers 和本地回调。应用仍为测试模式；面向公众开放前需完成 Google 发布设置。
- Stripe 正式收款使用主站 Worker 的 `STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`。在已被 Git 忽略的 `.env.stripe-live.local` 中配置正式 API 私钥和 `https://increasevideoquality.com/api/stripe/webhook` 对应的签名密钥，再运行现有的密钥准备及主站部署步骤。两项都只传给主站，开发服务器仍使用 `.env.local`。托管 Checkout 无需在浏览器配置公钥。
