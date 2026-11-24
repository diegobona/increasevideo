# 数据模型摘要

模型定义：`prisma/schema.prisma`。本地使用 SQLite，默认连接为 `file:./dev.db`（仓库根目录）；配置位于 `prisma.config.ts`，服务端客户端位于 `src/libs/db.ts`。

CLI、Client 和 adapter 统一锁定 Prisma `7.9.0`。验收发现 `7.10.1` 的 Studio 会将 `file:./dev.db` 整段误判为协议；`7.9.0` 的[协议解析源码](https://github.com/prisma/orm/blob/7.9.0/packages/cli/src/Studio.ts)使用标准 URL 解析。后续升级 Prisma 时须重新验证迁移和 SQLite Studio。

## 四张业务表

| 表 | 用途 | 关键字段与约束 |
| --- | --- | --- |
| `VideoJob` | 保存视频增强任务、服务端确认的原视频信息、第三方任务和输出结果 | `id` 使用 cuid；`status` 为 `PENDING / PROCESSING / SUCCEEDED / FAILED`；`scale` 仅允许 `2 / 4`；`ownerToken` 唯一，用于匿名查询结果；`originalFps` 保存服务端帧率，`billingVersion` 区分计费版本 |
| `Order` | 保存 Stripe Checkout 订单、支付状态和应授予额度 | `stripeSessionId` 唯一；`plan` 为 `SINGLE / TRIPLE / PACK20`；`status` 为 `PENDING / PAID / REFUNDED`；金额使用整数 `amountCents` 与 `currency`；`paidAt`、`expiresAt` 记录付费有效期，`refundedAmountCents` 保存累计退款 |
| `CreditLedger` | 记录免费发放、支付发放、消费扣减和必要的退款/冲正 | `delta` 为有符号整数：增加额度为正，消费扣减为负；`reason` 说明原因；`orderId` 可空，存在时外键关联订单 |
| `UsageEvent` | 记录访问路径、来源和 UTM 归因，并按需关联视频任务 | 包含 `visitorId`、`path`、`referrer`、`utmSource`、`jobId`、`createdAt`；允许先记录访问、后创建任务 |

四张表的 `id` 均为 `String @id @default(cuid())`，`createdAt` 默认当前时间；`VideoJob.updatedAt` 由 Prisma Client 在更新时维护。cuid 和 `@updatedAt` 是 Prisma 行为，直接执行原始 SQL 时需要自行提供相应值。

## 可空字段与默认值

- `VideoJob.originalUrl`、原视频时长、宽高均必填；`originalFps`、`resultUrl`、`resultWidth`、`resultHeight`、`providerJobId`、`errorMessage` 可空。原视频信息由服务端校验，付费任务要求可确认的帧率；处理结果的实际宽高在任务成功时保存；数据库字段本身不能证明视频参数真实。
- 新任务默认 `PENDING`，`denoise` 默认 `false`，`isFreeTier` 和 `watermark` 默认 `true`；`scale` 必须显式提供。
- `ownerToken` 由任务接口使用密码学随机数生成 32 位十六进制令牌；不会使用 `visitorId` 或任务 cuid 代替它。`visitorId` 来自 HttpOnly UUID cookie，用于额度身份及追踪，不承担结果访问授权。
- 新订单默认 `PENDING`。`stripePaymentIntentId` 在支付尚未完成、Stripe 尚未分配支付意图时可空；`paidAt` 和 `expiresAt` 在确认付款前可空，`refundedAmountCents` 默认为 0。创建 Checkout 前使用唯一的 `pending:` 会话占位，随后绑定 Stripe 实际会话。
- `CreditLedger.orderId` 可空，支持免费额度发放或不绑定某笔订单的消费扣减。
- `UsageEvent.referrer`、`utmSource`、`jobId` 可空，支持直接访问、无 UTM 的访问和创建任务前的访问。

## 额度规则

不存储可直接修改的余额字段。免费池使用未关联订单的账本净额：

```sql
SELECT COALESCE(SUM(delta), 0) AS credits
FROM CreditLedger
WHERE visitorId = ? AND orderId IS NULL;
```

每次扣减写入负数 `delta`，发放写入正数 `delta`。账本作为追加记录使用，更正通过新的冲正记录表达。任务接口实现一次性免费发放、创建任务与扣减的同一事务、并发防重复消费和失败幂等返还；已有访客的免费额度不会按天或重新访问重置。

付费池按有效的 PAID 订单明细净额计算，付款后 12 个月有效，按先到期订单优先消费；过期、未支付和全额退款订单不提供可用额度，退款形成的欠额仍抵扣未来可用额度。Stripe 签名回调使用唯一的 `order_grant:<orderId>` 记录发放；累计退款仅撤回新增差额，任务失败按原订单来源返还，不恢复过期时间。免费额度与付费 credits 不混用。详情见 [付费功能](payments.md)。

订单的 `creditsGranted` 保存该订单应授予额度的快照，只有写入账本的额度才计入余额。`plan` 枚举只是订单类型，不定义价格或额度；用户可见的价格、额度和时长限制统一来自 `src/config/pricing.ts`。

已批准的 USD 套餐为 $4.99 / $7.99 / $19.99，分别为 6 / 18 / 60 个付费 credits，每 credit 对应 10 标准秒；2K、4K 的时长倍率由定价配置决定，每个任务单独向上取整。`PACK20` 仅保留为数据库历史键，对应前台 Value 套餐，不再代表 20 次任务。

## 限流基础设施表

`RateLimitEvent` 由 `20261024011942_persist_rate_limits` migration 引入，属于四张业务表之外的限流基础设施，不参与余额计算。

| 字段 | 用途 |
| --- | --- |
| `id` | 事件 cuid 主键 |
| `scope` | 区分任务提交与元数据接口的计数范围 |
| `visitorId`、`ipHash` | 同一请求同时参与访客和 IP 两个维度；IP 以 SHA-256 值保存 |
| `createdAtMs`、`expiresAtMs` | 毫秒时间戳，使用 BigInt 保存滑动窗口边界和过期时间 |

表上有 `(scope, visitorId, createdAtMs)`、`(scope, ipHash, createdAtMs)` 和 `expiresAtMs` 索引。限流事务先清除过期事件并取得 SQLite 写锁，再检查两个维度并插入允许的请求，保证共享同一数据库的进程使用同一计数。已有计数不会因重启或删除浏览器 cookie 而消失；改变访客 cookie 后仍受 IP 维度限制。迁移与实际请求验收见 [额度与限流](quota-verification.md)，成本估算见 [免费成本](quota-cost.md)。

## 关联、索引与 SQL 约束

- `CreditLedger.orderId → Order.id`：`onDelete: Restrict`，已有账本记录时禁止删除对应订单。
- `UsageEvent.jobId → VideoJob.id`：`onDelete: SetNull`，删除任务后保留访问归因事件。
- 每张业务表都有 `(visitorId, createdAt)` 索引；另外覆盖待处理任务状态、第三方任务 id、Stripe PaymentIntent、账本订单、归因任务和 UTM 来源查询。
- 初始 migration SQL 为任务状态、订单状态、订单套餐和任务倍数添加数据库 `CHECK` 约束。`20261024032310_paid_time_credits` 加入 `Order.paidAt`、`expiresAt`、`refundedAmountCents` 及 `VideoJob.originalFps`、`billingVersion`；`20261024032500_restore_enum_constraints` 在后续表结构中保留枚举与倍数 SQL CHECK。Prisma schema 不表达这些自定义 SQLite `CHECK`；修改枚举或允许的倍数时，必须同时维护后续 SQL migration 并运行 `pnpm test:db`。
- 除四张业务表和 `RateLimitEvent` 外，Prisma 在开发数据库中维护内部表 `_prisma_migrations`，用于记录已应用的迁移。

## 本地命令

```sh
pnpm install
pnpm db:migrate
pnpm db:generate
npx prisma studio
pnpm test:db
pnpm lint && pnpm build
```

首次使用时将 `.env.example` 复制为 `.env`。数据库文件和生成的客户端代码已忽略，SQL migrations 和 `migration_lock.toml` 应随源码保存。构建只生成客户端，不自动运行数据库迁移。

当前 `src/libs/db.ts` 使用 Prisma 官方 libSQL adapter 访问本地 SQLite 文件，不需要单独运行数据库服务。上线使用 Cloudflare D1 时需要接入 D1 adapter 和 D1 的 migration 执行流程，本次不变更 `AGENTS.md` 中的部署目标，也不将本地迁移成功等同于 D1 部署完成。
