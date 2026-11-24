# 视频增强管线

## 当前实现

`POST /api/jobs` 接收 `{ url, scale, denoise, tier }`，`tier` 可选择免费或付费池。身份来自已验证的 Google 登录会话，新账本的 visitorId 保存 Account.id；请求体中的 visitorId 不参与身份或额度计算。服务端从 fal 重新读取源视频时长、分辨率及帧率，不接受客户端的价格、扣减额度数或水印开关。

免费初始额度按 Google 账号幂等发放，不因清 cookie、购买或再次访问而重复赠送。免费与付费分池计算，不存在可直接修改的余额字段：免费池使用未关联订单的账本明细；付费池按有效订单的明细净额计算，排除过期、未支付及全额退款订单，同时保留退款形成的欠额抵扣。
创建任务与条件扣减在同一 SQLite 事务中完成：并发请求无法花费同一份余额。付费按服务端报价扣除，保留每笔扣减的 orderId，优先消费即将到期的订单；余额不足返回 402 / `INSUFFICIENT_CREDITS`。

事务提交后调用 provider，保存 provider 任务标识。提交失败或处理失败会将任务标记为 FAILED，并通过 `JOB_REFUND:<jobId>` 账本项退回实际扣减值；重复轮询不会重复退额度。

成功提交返回 `{ ok: true, data: { jobId }, jobId }` 并设置 `ownerToken` cookie：

- 使用密码学随机数生成 32 位十六进制令牌。
- HttpOnly、SameSite=Lax；HTTPS 请求带 Secure。
- 分别设置 `/api/jobs/<jobId>` 与 `/result/<jobId>` 路径的 cookie，供任务查询及结果页使用；创建其他任务不会覆盖旧任务的所有权 cookie。
- 令牌不放在 JSON、URL 或 localStorage 中。

`GET /api/jobs/[id]` 先检查 cookie，再访问 provider。缺少或错误的 cookie（包括另一个有效任务的 cookie）返回 403。
状态统一为 PENDING / PROCESSING / SUCCEEDED / FAILED。成功结果及实际输出宽高经服务端再次检查所选计费档位限制后落库，终态直接读数据库，旧的处理中响应不会覆盖终态。结果页实现与验收见 [结果页](result-verification.md)。

创建接口同时限制每个访客每小时 3 次、每个 IP 每小时 10 次。`src/libs/rateLimit.ts` 使用 SQLite `RateLimitEvent` 表保存滑动窗口事件，清理、检查和写入在同一事务中完成；共享数据库的进程共享计数，重启或清除 cookie 不清除 IP 限流。业务失败的提交也计数，超限返回 429 和 `Retry-After`。查询接口仍使用单进程 IP 限流。全部频率来自 `src/config/pricing.ts`。

前端提交后按 pricing 配置轮询。达到查询时限显示 Retry status check，重新查询同一个 jobId，不重新 POST，也不再次扣额度。临时的网络错误、服务端错误会继续查询至时限。成功后显示下载链接。

免费任务 provider 参数强制 `watermark: true`，付费任务使用去水印分支。已批准套餐为 USD $4.99 / $7.99 / $19.99，对应 6 / 18 / 60 个付费 credits；每 credit 为 10 标准秒，2K、4K 按对应档位折算后取整，确认付款后 12 个月有效。Stripe Checkout、签名回调和累计退款已接入，配置见 [付费功能](payments.md)。新任务与账本的 `visitorId` 字段保存 Google Account.id；匿名 visitor cookie 只用于归因和未登录限流。清 cookie 后重新登录同一 Google 账号不会重新获得试用，同一 IP 的请求总数也仍受限。反滥用验收见 [额度与限流](quota-verification.md)，请求次数与成本假设见 [成本估算](quota-cost.md)。

## 免费试用后处理（2026-11-22）

默认免费流程已改为 Topaz Precision + 独立 FFmpeg HTTP 服务，不再要求配置自定义 `FAL_FREE_VIDEO_MODEL`。裁剪、烧录水印、最终输出限制、私有 R2 保存与链接续签的实现及部署说明见 [免费视频后处理](video-worker.md)。

本地 `pnpm dev` / `pnpm start` 会同时启动水印服务。服务就绪检查在扣额度和增强之前进行；失败不会默默返回没有水印的视频。并发轮询通过数据库租约串行处理，并持久保存后处理检查点，避免 metadata 重试重复烧录。

原有完整 fal 工作流仍可通过 `FAL_FREE_VIDEO_MODEL` 选择，但该选项现在是可选兼容分支，不是本地试用的前置条件。

本次按用户要求只运行代码测试、构建与服务就绪检查；真实视频端到端操作留给用户验证。

## 测试与运行

```sh
pnpm test
pnpm lint && pnpm build
pnpm start
```

`tests/jobs.test.ts` 使用 Prisma + 独立共享内存 SQLite，应用真实 migration，并注入 mock provider：验证提交、轮询、结果落库、错误 cookie、重复/并发消费、失败退款和输出限制。不会改动开发数据库。
`tests/job-polling.test.ts` 使用虚拟时钟验证轮询间隔、超时及原任务重试；无需实际等待。
`tests/provider.test.ts` 模拟 fal HTTP 响应，验证队列协议及水印约束。

R2 和 fal 密钥已经本地配置。真实云端增强由用户自行验证；mock 测试通过不等于已完成真实视频联调。

本地 SQLite 驱动使用 Node.js 任务、元数据及支付路由。需要应用全部 migration，包括 `20261024032310_paid_time_credits` 与 `20261024032500_restore_enum_constraints`；它们加入支付有效期、退款及计费元数据，并保留 SQL CHECK 约束。Cloudflare Pages SSR、D1 及共享限流适配仍处于 README 中的待部署状态，不能直接把当前本地数据库模块部署为 Edge Function。上传、轮询、下载及 Stripe webhook 的进程内 IP 限流还需要部署平台共享或边缘限流保护。

## 初次管线验收（2026-10-23）

以下为付费功能接入前的历史记录；当前付费规则与验收范围见 [付费功能](payments.md)。

- `pnpm test`：43/43 通过。
- `pnpm lint && pnpm build`：退出码 0，任务创建和查询路由成功生成。
- Mock provider + 真实 SQLite：提交 → PROCESSING → SUCCEEDED，resultUrl 落库；另一有效任务的 owner cookie 访问返回 403；同一访客第二次提交返回 402；并发提交仅一次成功。
- 生产 `pnpm start` 后，curl 使用错误 cookie 请求 `/api/jobs/nonexistent` 返回 HTTP 403、`{"ok":false,"error":"无权查看此视频任务","code":"FORBIDDEN"}`，确认生产构建能够加载 SQLite 驱动并执行查询。
- 首页 curl/grep 仍包含 H1、How it works 及全部六条 FAQ 问题。
- 真实 fal 增强及水印工作流联调未执行，仍需上文的配置和部署。
