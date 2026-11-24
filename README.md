# increasevideoquality.com

Next.js 15 App Router + TypeScript + Tailwind 视频增强网站。本地使用 Next.js 和 SQLite，Cloudflare 使用 vinext SSR、D1、R2 和私有 FFmpeg 容器。项目约束见根目录 `AGENTS.md`。

## 本地运行

使用 Node.js 22.12+（22.x）或 24+，以及 `package.json` 指定的 pnpm 版本。

```sh
pnpm install
pnpm dev
```

开发服务器默认运行在 http://localhost:3000。`pnpm dev` 与 `pnpm start` 同时启动本地 FFmpeg 水印服务；本机所需工具路径已配置。服务说明与容器部署见 [免费视频后处理](docs/video-worker.md)。

## 验收与生产运行

```sh
pnpm test
pnpm lint && pnpm build
pnpm start
```

`pnpm typecheck` 可单独检查 TypeScript。`pnpm build` 也会执行类型检查。

首页为 Server Component，并使用动态服务端渲染；H1、正文、案例文案和 FAQ 直接包含在响应 HTML 中。独立的 `UploadCard` Client Component 支持文件选择、拖拽、格式与大小校验、倍数选择和去噪开关；结果页的 Client Component 负责视频播放控制。公开价格及限制统一位于 `src/config/pricing.ts`。

上传、元数据检查、任务提交和状态轮询已实现：选择文件上传到私有 R2，由 fal 读取真实参数；提交后使用账本额度并创建任务，成功结果落库后提供下载。接口、密钥和 CORS 配置见 [上传流程](docs/upload-flow.md)。模型配置、免费水印后处理、额度事务与测试见 [视频增强管线](docs/video-pipeline.md)。Stripe 托管 Checkout、验签回调、付费额度及退款记账已实现，未配置密钥时不会真实收款；R2/fal 本地密钥已配置，免费水印服务已实现；真实视频联调由用户自行验证，Stripe 实际收款仍需对应配置。案例为已标注的模拟模糊输入与原始参考视频，素材来源见 `public/demos/README.md`。首页验收记录见 `docs/homepage-verification.md`。

当前付费套餐为 USD $4.99 / $7.99 / $19.99，分别授予 6 / 18 / 60 个付费 credits，每 credit 对应 10 标准秒；2K、4K 各自按预计输出档位折算，每个任务单独取整，付费额度从确认付款起 12 个月有效。免费池与付费池独立，付费不加水印，失败按原订单来源返还额度。SSR 定价页为 `/pricing`，套餐规则、香港 Stripe 配置和验收范围见 [付费功能](docs/payments.md)。

`/result/[jobId]` 为鉴权后的 SSR 结果页，包含实际分辨率说明、左右播放器、共享播放控制和附件下载，并设置 noindex；不存在或无权访问的任务返回 404。实现细节和 curl 结果见 [结果页验收](docs/result-verification.md)。

上传和处理前必须使用 Google 登录；不提供游客试用。每个 Google 账号只获得一次最多 5 秒、1080p、带水印的试用，额度记录在 `CreditLedger`，清 cookie、重新登录或更换浏览器不会重置。任务及新订单使用服务端会话对应的账号身份，忽略请求体中的访客标识。失败时退还原额度。任务创建同时限制账号每小时 3 次、IP 每小时 10 次；元数据接口限制账号每分钟 6 次、IP 每分钟 20 次。两者使用 SQLite `RateLimitEvent` 持久滑动窗口计数，超限返回 429 和 `Retry-After`，删除 cookie 不清除 IP 限制。验收与测试脚本见 [额度与反滥用](docs/quota-verification.md)，每日请求量与成本假设见 [免费成本估算](docs/quota-cost.md)。

Google 登录配置和本次验收见 [Google 登录与账号试用](docs/google-auth.md)。新环境执行 `pnpm db:migrate`，已有环境也需应用 `20261121124611_google_account_trial`。

## 数据库

使用 Prisma 7 和本地 SQLite，包含 `VideoJob`、`Order`、`CreditLedger`、`UsageEvent` 四张业务表，以及限流表 `RateLimitEvent` 和登录表 `Account`、`AuthSession`、`GoogleAuthFlow`。字段、关联和额度记账约定见 [schema 摘要](docs/database-schema.md)。

新环境先将 `.env.example` 复制为 `.env`，再运行：

```sh
pnpm install
pnpm db:migrate
npx prisma studio
```

默认数据库为仓库根目录的 `dev.db`。`pnpm install` 和 `pnpm build` 会生成 Prisma Client；构建不会自动修改数据库。Prisma Studio 启动地址以终端输出为准。

已有环境也需运行 `pnpm db:migrate`，应用 `20261024011942_persist_rate_limits`、`20261024032310_paid_time_credits` 及 `20261024032500_restore_enum_constraints` 等尚未执行的迁移。后两项加入支付时间、到期时间、累计退款金额、原视频帧率及计费版本，并保留原有 SQLite 枚举与倍数 CHECK 约束。

```sh
pnpm test:db
pnpm lint && pnpm build
```

`pnpm test:db` 在独立内存数据库中验证实际迁移的约束，不修改开发数据。

## Cloudflare 部署状态

用户已于 2026-11-23 批准改为 Workers 并保留 SSR。临时地址：https://increasevideoquality.zw83716.workers.dev 。自有域名尚未接入本账号。

线上数据库为 `increasevideoquality-db`；业务扣费、退款和试用发放使用带并发版本校验的 D1 原子批处理，线上 API 限流计数由 D1 共享。Google、fal、R2 凭据使用 Worker Secrets。裁剪和水印使用独立私有容器服务，主应用通过 Service Binding 调用。

部署命令、资源、验收和待配置项见 [Cloudflare 部署](docs/cloudflare-deployment.md)。`pnpm lint && pnpm build` 继续验证标准 Next.js 构建，`pnpm build:vinext` 生成 Cloudflare 部署产物。Stripe 尚未配置真实收款，Google 应用仍为测试模式；真实登录和视频增强由用户验收。
