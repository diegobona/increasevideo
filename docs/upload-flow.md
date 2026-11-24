# 视频上传与元数据校验

## 本地配置

将 `.env.example` 中的 R2 和 fal 配置填入 `.env.local`，重启 Next.js。
R2 使用私有 bucket `video-input`，S3 凭据需要该 bucket 的对象读写权限。
不需要公开 bucket，也不要把密钥放在 `NEXT_PUBLIC_*` 中。

为前端直传配置 R2 CORS（生产替换为实际站点来源）：

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://increasevideoquality.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"],
    "MaxAgeSeconds": 3600
  }
]
```

同时配置 R2 未完成分片的清理规则；代码会在上传失败时尝试中止分片。
已完成文件的定期删除尚未实现，页面已据实披露，链接过期不等于删除文件。

## 接口与流程

成功响应同时包含 `data` 及需求约定的顶层字段，例如
`{ ok: true, data: { url, key }, url, key }`；失败返回
`{ ok: false, code, error }`。响应不缓存。

1. `POST /api/upload` 接受一个 multipart `file`，流式分片写入 R2，返回私有对象的临时 GET URL 和 key。
2. 同一接口也接受 JSON `{ filename, size, contentType }`，返回 `uploadUrl`、必要 `headers`、GET `url` 和 `key`。前端以文件本体 PUT 到该地址，文件不会经过 Next.js。签名绑定 Content-Length、Content-Type、If-None-Match，禁止覆盖已上传对象。
3. 前端上传完成后请求 `POST /api/video/metadata`，请求体只含 `{ url }`。R2 文件先由服务端检查实际大小、文件类型和文件头，再传给 fal 的 `fal-ai/ffmpeg-api/metadata`，只使用 `media.duration` 和 `media.resolution`。
4. 返回 `{ durationSec, width, height, validation }`。即使免费额度超限，也返回真实参数供展示；`validation` 包含 `FREE_LIMIT_DURATION` 或 `FREE_LIMIT_RESOLUTION` 和提示文字。免费任务需要水印，不能传 `watermark: false` 绕过规则。
5. UploadCard 展示服务端参数并立即提示超限。创建任务接口会重新读取服务端参数并调用校验函数，不采用浏览器提交的参数或本地校验结果。提交内容为 `{ url, scale, denoise }`；匿名身份使用服务端设置的 HttpOnly UUID cookie，不读取 localStorage 或请求体中的 `visitorId`。

大小、格式、免费规则和请求频率均从 `src/config/pricing.ts` 读取。
multipart 的实际文件字节计数和直传后的 R2 HEAD 都会再次检查大小；客户端声明不能替代服务端检查。

前端使用直传是为了绕开 Cloudflare 的入站请求体限制，multipart 接口仍受部署平台的入站限制。
参见 [R2 预签名 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) 和
[Cloudflare Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)。

上传及参数检查不会启动增强或扣减额度。点击提交后通过任务接口处理，见 [视频增强管线](video-pipeline.md)；真实服务需要配置密钥及免费水印工作流。

## 限流

元数据接口同时限制每个访客每分钟 6 次、每个 IP 每分钟 20 次。计数保存在 SQLite `RateLimitEvent`，在同一事务中检查和写入滑动窗口事件；共享同一数据库的进程共享计数，重启不重置。

创建任务接口限制每个访客每小时 3 次、每个 IP 每小时 10 次；清除 cookie 不清除 IP 计数。上传接口仍使用每 IP 每分钟 10 次的进程内滑动窗口限流。所有限流超限均返回 429 和 `Retry-After`，实际频率以 `src/config/pricing.ts` 为准。

设置 `TRUST_CLOUDFLARE_PROXY=true` 后按 Cloudflare 提供的 CF-Connecting-IP 分桶。
仅在 Cloudflare 边缘保护的源站启用，不能信任任意客户端伪造的转发头。
未启用时共享保守的匿名桶，防止在直接暴露的本地源站伪造 IP 绕过限流。

元数据与任务创建路由因 SQLite 持久限流使用 Node.js runtime。部署 Cloudflare 前仍需完成 D1/SSR 适配；上传、任务轮询和下载的进程内计数不跨实例共享，需要额外的共享或边缘限流保护。不能把本地 SQLite 实现当作已经完成 Cloudflare 部署。

免费额度不会按天重置，发放、扣减与退款均记录在 `CreditLedger`。验收记录见 [额度与限流](quota-verification.md)，每日请求次数及成本假设见 [成本估算](quota-cost.md)。

## 验证

```powershell
pnpm test
pnpm lint && pnpm build
pnpm start
```

真实联调需配置 FAL_KEY，并将以下 URL 替换为公网可读、已确认时长的测试视频；也可使用上传接口返回的临时 URL。
JSON 中故意携带伪造的时长/分辨率，接口应仍返回 fal 读取的真实数值：

```powershell
'{"url":"https://YOUR_HOST/thirty-seconds.mp4","durationSec":1,"width":1,"height":1}' | Set-Content -Encoding utf8 metadata-request.json
curl.exe -sS http://localhost:3000/api/video/metadata -H "Content-Type: application/json" --data-binary "@metadata-request.json"
```

真实 30 秒视频的预期值：`durationSec: 30`、`validation.code: "FREE_LIMIT_DURATION"`。
没有密钥时接口明确返回 503 / METADATA_NOT_CONFIGURED，不会回退到客户端数据。

自动化测试通过模拟 fal/R2 响应覆盖服务端参数来源、限流、签名、流式分片和失败清理，不代表已经完成真实云服务联调。
