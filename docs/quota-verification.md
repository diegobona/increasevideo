# 额度与反滥用验收

日期：2026-10-24。

## 实现

- `src/config/pricing.ts` 导出 FREE、SINGLE、TRIPLE、PACK20；现有页面和服务端校验通过派生配置引用同一组数值。
- 首次访问由 middleware 设置 UUID `visitorId`：HttpOnly、Path=/、SameSite=Lax，HTTPS 时附加 Secure；当前 API 请求也立即使用同一 UUID。UploadCard 不再使用 localStorage 或在请求体提交身份。
- 免费发放使用唯一 `free_grant:<visitorId>` 账本记录，不按天或刷新补发。余额由 delta 求和；扣减、退款均追加记录。伪造请求体 visitorId 不改变消费身份。
- `src/libs/rateLimit.ts` 使用新增基础设施表 RateLimitEvent，事务内完成滑动窗口检查和记录，过期记录清理。jobs 同时限制 visitorId 3 次/小时、IP 10 次/小时；metadata 同时限制 visitorId 6 次/分钟、IP 20 次/分钟。超限返回 429、Retry-After。
- 计数发生在参数校验、额度检查及外部调用之前，错误请求也消耗次数；429 本身不延长窗口。免费任务的 provider 参数固定来自 FREE.watermark=true，客户端不能关闭。
- IP 只在 `TRUST_CLOUDFLARE_PROXY=true` 且源站受 Cloudflare 保护时信任 CF-Connecting-IP；其他情况合并到保守的未知来源桶，不接受伪造 X-Forwarded-For。测试未启用代理信任，所有本机请求共用此桶。

## 自动化

`pnpm test`：**66/66 通过**。覆盖一次性额度、并发扣减、伪造请求体身份、免费水印、20 次提交、第 4 次拦截、新 cookie 的 IP 上限、重建 handler 后计数保留、滑动窗口过期、并发限流、metadata 六次限制及 cookie 属性。

Mock provider 与真实 SQLite 集成测试的提交序列：

```text
第 1 次：200（扣减一份免费额度，watermark=true）
第 2–3 次：402（额度不足）
第 4–20 次：429（Retry-After > 0）
```

`pnpm lint && pnpm build`：退出码 0。数据库迁移 `20261024011942_persist_rate_limits` 已在本地应用，Prisma Client 已生成。

## 生产构建的真实 HTTP 验收

使用独立 SQLite 测试库，`pnpm start --port 3004 --hostname 127.0.0.1` 启动生产构建后运行：

```sh
pnpm test:rate-limit http://127.0.0.1:3004
```

该脚本必须对空的限流测试库运行，已有计数会使拦截提前。它发送 `{}`，让参数校验返回 400，不会上传视频或调用 fal。实际结果：

```text
same-cookie #1: HTTP 400
same-cookie #2: HTTP 400
same-cookie #3: HTTP 400
same-cookie #4: HTTP 429 Retry-After=3600
... #5–19 均为 HTTP 429 ...
same-cookie #20: HTTP 429 Retry-After=3600
cleared-cookie #1–7: HTTP 400
cleared-cookie #8: HTTP 429 Retry-After=3600
cleared-cookie #9: HTTP 429 Retry-After=3600
cleared-cookie #10: HTTP 429 Retry-After=3600
PASS: requests 4–20 blocked; clearing cookies cannot bypass the shared IP limit.
```

第二阶段每次都不发送 cookie，模拟清除 cookie / 新无痕会话，服务端为每次请求创建新访客；第一阶段已经占用同一 IP 的 3 次额度，所以再接受 7 次后，后续新访客同样返回 429。这里验证的是新会话的 HTTP 行为，没有声称操作了浏览器无痕窗口。

metadata 使用同一 cookie 连续请求，真实 HTTP 结果：

```text
metadata #1–6: HTTP 400（无效参数，不调用 fal）
metadata #7: HTTP 429 Retry-After=60
```

首次首页请求响应片段：

```text
HTTP/1.1 200 OK
set-cookie: visitorId=<server-generated UUID>; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
Increase Video Quality: true
How it works: true
```

## 成本

见 [成本估算及假设](quota-cost.md)：每 IP 最多通过 240 次提交尝试/24 小时。按官方 10 秒 720p/30fps 示例增强价 $0.10/次，示例为 **$0.10 × 240 = $24/IP/日**。这不包括水印、metadata、R2 等费用，也不是全站账单硬上限；实际免费工作流及其处理分辨率、帧率、计费仍待配置确认。
