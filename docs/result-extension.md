# 结果页延伸区块

实现位置：`/result/[jobId]` 的对比播放器下方。区块标题、说明、推荐和按钮在初始 HTML 中，结果页仍是 Server Component。首页处理完成后提供结果页入口。

## 页内处理

- 1080p 和 4K 都使用该账户任务的原始上传文件。
- 每次新处理都是付费任务，处理完整原始上传（即使来源是五秒试用），按钮提前显示额度。试用不会重置。无法达到的尺寸禁用。
- 新版本使用 Rhea，降噪固定关闭，历史任务的降噪设置仅作为处理记录。
- 服务端重新读取元数据、校验账户归属、强制 PAID，并限制扣费不高于页面报价；沿用原有限流、原子扣费和失败退款。
- 处理中保留旧结果，成功后在原页更新播放器和下载按钮。可选择本次会话的旧版本。超时只重查原任务，不再次付费提交。
- 新结果不会自动播放或自动打开弹窗。
- 推荐根据源尺寸、结果尺寸和降噪设置挑选三个不同的指南，不推断视频拍摄场景。解释文字随降噪设置变化。

## 统计

`POST /result/[jobId]/events` 校验路径范围内的 HttpOnly ownerToken、同源、事件及目标白名单，并按 visitorId 和 IP 限流。事件只写本站 UsageEvent；没有增加 GA4 或第三方分析服务。

| eventType | 含义 |
| --- | --- |
| result_extension_impression | 延伸区块进入可见区域，每次页面挂载一次 |
| result_extension_click | 点击输出档位或推荐链接，target 标记目标 |
| result_page_view | 结果页或从结果推荐进入的指南访问 |
| result_visible_time | 页面处于前台的累计毫秒数，不等于用户专注时间 |

sessionStorage 将结果页与直接点击的推荐页关联，避免给 URL 加账户或任务信息。每次页面访问的停留记录使用同一个事件 ID，心跳每 15 秒及隐藏/离开时上报累计值；服务端保留最大值，重复或乱序消息不累计叠加。后台时间不计入。浏览器强退、屏蔽脚本或丢失最后一次 beacon 会使记录低估；不能把它宣称为完整的 GA 会话时长。

查询推荐点击：

```sql
SELECT target, COUNT(*) AS clicks, COUNT(DISTINCT sessionId) AS sessions
FROM UsageEvent
WHERE eventType = 'result_extension_click' AND target LIKE '/%'
GROUP BY target;
```

查询各页面可见停留：

```sql
SELECT path, COUNT(*) AS visits,
       ROUND(AVG(durationMs) / 1000.0, 2) AS avg_visible_seconds,
       ROUND(SUM(durationMs) / 1000.0, 2) AS total_visible_seconds
FROM UsageEvent
WHERE eventType = 'result_visible_time'
GROUP BY path;
```

曝光转化应按 sessionId 去重，并按时间窗/同一试验分组比较。点击 4K 等按钮代表处理意图，不能等同于支付成功或增强成功。

## 验证与发布

- lint、Next.js production build 通过。
- 完整测试 170/170；新增测试 9/9，亦通过 Prisma D1 适配器测试（本地 SQLite 模拟 D1，不连接远程）。
- 原始 HTML 检查、三个推荐页面 200、越权结果 404、Edge 点击及实际数据库事件见 `result-extension-verification.txt`。
- 页面截图 `result-extension-preview.jpg` 使用本地隔离的模拟任务和既有演示素材，不能当作真实 AI 增强效果证明。
- 未调用真实 fal、Google 登录或 Stripe 支付，未更改真实账户额度。
- Prisma 迁移：`20261123090000_result_engagement`。Cloudflare 对应增量迁移：`0002_result_engagement.sql`。
- 已于 2026-11-23 发布到 `https://increasevideoquality.zw83716.workers.dev`，版本 `9e448690-0a7f-4852-b0b2-94bf09244edc`；生产 D1 迁移已应用。线上 SSR 11/11 与接口保护检查通过，见 `result-extension-live-ssr.txt` 和 `result-extension-live-smoke.txt`。私有结果页的线上联调未进行；本地模拟结果验证记录仍在 `result-extension-verification.txt`。
