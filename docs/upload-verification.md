# 上传流程验收记录

日期：2026-10-23。本机未配置 R2/fal 密钥；按用户要求先完成实现和本地测试。

## 自动化测试

`pnpm test`：29 个测试全部通过，其中免费规则 7 项、现有数据库 8 项、上传/元数据接口 14 项。

最终执行 `pnpm test && pnpm lint && pnpm build`，退出码为 0；两个 API 均以动态 Edge 路由构建成功，首页继续服务端渲染。

测试覆盖：9/11 秒、720p/1080p、恰好 10 秒、强制水印、无效元数据、严格小于文件上限、签名绑定长度及禁止覆盖、实际 R2 对象验证、分片上传及失败中止、两个 API 限流。

fal 测试使用官方 `media.duration` / `media.resolution` 响应结构的模拟数据。
请求携带 `durationSec: 1, width: 1, height: 1`，模拟 fal 返回 30 秒、1280×720；真实 Route Handler 的响应断言为 `durationSec: 30`，并返回 `FREE_LIMIT_DURATION`。
这项测试证明参数来源，不代表已调用真实 fal 服务。

## 生产服务器 curl

执行 `pnpm start --port 3002 --hostname 127.0.0.1`，请求真实 Next.js Edge Route Handler。

向 `/api/video/metadata` 发送公网 HTTPS 示例 URL 及伪造时长时，因缺少密钥返回：

```text
HTTP/1.1 503 Service Unavailable
{"ok":false,"error":"视频参数服务尚未配置，请联系管理员","code":"METADATA_NOT_CONFIGURED"}
```

同一来源连续发起 21 次请求，实际 HTTP 状态统计：

```text
Name Count
429      1
503     20
```

缺少配置的请求也计入额度，第 21 次被限制，不会回退采用客户端参数。

向 `/api/upload` 用 `curl.exe -F 'file=@public/demos/flowers-before.mp4;type=video/mp4'` 发送 multipart，返回明确的配置错误：

```text
HTTP/1.1 503 Service Unavailable
{"ok":false,"error":"视频上传服务尚未配置，请联系管理员","code":"STORAGE_NOT_CONFIGURED"}
```

首页 `curl | grep -oE ...` 的去重结果仍包含服务端文案：

```text
Increase Video Quality
How it works
How much can I upscale a video?
How long does a one-minute video take to process?
Will you keep my original video?
Which video formats are supported?
How long can a free video be?
Are my video files safe?
```

## 待配置后的真实验收

真实 R2 上传、浏览器直传 CORS，以及 30 秒视频的真实 fal 调用尚未执行。
配置步骤与 curl 命令见 [上传流程](upload-flow.md)。
