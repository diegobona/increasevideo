# 一次性付费时长包

生效配置：`src/config/pricing.ts`。网站使用 USD 标价和收款；香港 Stripe 的 HKD 结算由 Stripe 后台及绑定银行账户处理，不将美元金额直接当成港元金额。

| 数据库套餐键 | 展示名称 | 一次性价格 | 付费 credits | 全部用于 1080p | 全部用于 2K | 全部用于 4K |
| --- | --- | --- | --- | --- | --- | --- |
| SINGLE | Starter | $4.99 | 6 | 60 秒 | 48 秒 | 24 秒 |
| TRIPLE | Creator | $7.99 | 18 | 180 秒 | 144 秒 | 72 秒 |
| PACK20 | Value | $19.99 | 60 | 600 秒 | 480 秒 | 240 秒 |

PACK20 是 Value 套餐的历史数据库枚举键。每个付费 credit 对应 10 标准秒。服务端根据预计输出的长短边，选择能容纳两边的最低档位。1080p、2K（2560×1440）、4K 分别按 1、1.25、2.5 倍折算，每个任务单独向上取整到完整 credit。横屏与竖屏遵循同一规则。新付费任务记录 billingVersion 3，历史扣费及退款以实际账本为准。

一条 60 秒视频输出 2K 时扣 8 credits，输出 4K 时扣 15 credits。按 Value 套餐分摊，这两条报价分别约为 $2.67 和 $5.00。短任务单独取整。付费输入最高 30fps，单条视频最长 5 分钟，总套餐时长可分多次使用。

付费视频不加水印。免费池仍按原配置发放一次额度、最长 10 秒、最高 720p 并强制水印。两池独立，购买付费额度不清除或重置免费使用记录。成功任务扣减和失败返还均通过 CreditLedger 记录，付费明细保留 orderId。

## Stripe 配置

正式收银台使用普通 Stripe Payments，销售方为本站运营公司。创建每笔 Checkout Session 时显式发送 `managed_payments[enabled]=false`，覆盖该账户的默认设置。三档美元标价及订单入账金额沿用服务端套餐配置。已创建的 Session 沿用创建时的收款设置。

在本机 `.env.local` 设置，不要提交密钥：

```dotenv
APP_URL="http://127.0.0.1:3002"
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

生产 APP_URL 必须是可信 HTTPS 站点根地址。它决定 Checkout 成功及取消回跳地址，不能采用任意客户端 Host 或 returnUrl。正式环境替换为实际域名和生产密钥。重启服务后生效。

`POST /api/checkout` 接收 `{ "plan": "SINGLE" }`，也支持 TRIPLE、PACK20。服务端读取套餐配置、建立待支付订单、用订单 ID 作为 Stripe Idempotency-Key，并返回 JSON 中的 Stripe Checkout URL。SSR 定价页通过 Server Action 发起购买，价格及权益直接渲染进 HTML。未配置 Stripe 时明确返回 503，不模拟付款成功或授予额度。

`POST /api/stripe/webhook` 使用 Stripe-Signature 对原始请求体验签，校验时间戳、会话、订单、实付金额、币种及付款状态。只有受信付款事件可以在事务内入账，唯一的 order_grant:<orderId> 明细使重复回调无法重复发放。成功回跳页只读取本访客订单，不负责发额度。

配置回调事件：

- checkout.session.completed
- checkout.session.async_payment_succeeded
- charge.refunded

本地可以用 Stripe CLI 转发到 `/api/stripe/webhook`，将 CLI 输出的签名密钥放入 STRIPE_WEBHOOK_SECRET；测试模式与生产模式的签名密钥不同。无需预建 Stripe Price ID，Checkout 使用服务端配置的 price_data。实现依据：[Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)、[Webhook 签名和重试](https://docs.stripe.com/events/manage-webhook-endpoints)。

## 额度、有效期及退款

付费额度从确认付款起 12 个月有效，按即将到期的订单先消费。免费明细和付费明细不合并为一个可任意修改的余额。过期订单、未支付订单及全额退款订单不提供有效付费额度；退款形成的欠额不能通过忽略负数订单或再次购买绕过。

经 Stripe 确认的退款按累计退款金额比例向上取整撤回对应订单额度，重复事件只处理新增差额。退款后的已用额度可能形成欠额；它不是额外发放余额。失败任务返还原始订单来源的扣减，已过期或已退款订单不会因返还而恢复有效期。退款支持的是付款处理与账本同步；本站没有新增直接发起退款的管理界面。

余额及结果访问依赖匿名 HttpOnly visitorId / ownerToken cookie。保留购买时的浏览器 cookie；目前没有账号登录或通过邮箱跨浏览器恢复额度的功能。

## 本地验收范围

```sh
pnpm db:migrate
pnpm test
pnpm lint && pnpm build
pnpm start
```

测试使用独立 SQLite、真实 handler 和签名算法，注入 mock Stripe/fal。测试付款入账、重复及乱序回调、退款、额度到期、免费/付费分池、付费报价和并发扣减。未配置密钥期间不执行真实扣款或收费视频增强。真实联调需要 Stripe 测试密钥、回调转发，以及 R2 / fal 配置；免费任务另需部署已有的水印工作流。

## 香港结算成本参考

价格已按用户批准固定；此段仅解释预算，不是用户售价来源。以国际卡、USD 收款转 HKD 的香港 Stripe 标准费率 5.9% + HK$2.35、预算汇率 7.8 计算，三档每单处理及支付成本约为 $1.95 / $4.82 / $14.98，对应贡献额约 $3.04 / $3.17 / $5.01。预算按 1080p 大量短任务每标准分钟 $1.20 模型成本，另外预留模型费的 10% 重跑和每标准分钟 $0.03 基础设施费用。

贡献额尚未扣免费试用补贴、获客、税费和固定运营费用。来源：[fal Precision](https://fal.ai/models/topaz/upscale/video/precision)、[Stripe 香港费率](https://stripe.com/en-hk/pricing)。这些是公开报价预算，不是已发生的真实账单。

2026-11-24 核对了 30 fps 单条 60 秒视频的公开报价。[fal 的 Proteus 4K 示例](https://fal.ai/models/topaz/upscale/video/precision)为 $3.10。按上述支付假设、10% 重跑预留以及 2.5 个标准分钟的基础设施预算，Value 包的 4K 报价约 $5.00，预计贡献额约 $1.14。fal 没有在同一价目表中列出 1440p 的一分钟成本。

同预算对照采用 [AIUpscaler 的 $19.90 / 1,600 credits 套餐](https://aiupscaler.video/pricing)。60 秒 2K 的 Video2X 报价折合约 $2.99，60 秒 4K 的 Topaz 与 Video2X 报价分别约 $7.77、$3.11。
