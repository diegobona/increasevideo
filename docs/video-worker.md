# 免费视频裁剪与后处理

## 当前流程

Google 登录后，每个账号一次试用；上传上限、处理长度和输出大小以 `src/config/pricing.ts` 为唯一配置来源。目前可上传最多 60 秒（1 分钟），服务器只增强开头最多 5 秒，下载文件最高 1920×1080，并烧录 `increasevideoquality.com` 水印。

1. 服务端校验真实视频参数、账号额度和后处理服务就绪状态。
2. 事务预留额度，必要时由自有 FFmpeg 服务裁剪开头片段，把片段存入私有 R2 并复查长度。裁剪不调用 fal Compose 或任何付费裁剪 API。
3. 按服务端复查后的片段尺寸限制放大倍率，再调用 Topaz Precision，目标输出不超过 1920×1080。`FAL_FREE_VIDEO_MODEL` 可以留空。
4. Topaz 完成后，经过认证的 FFmpeg 服务下载该输出，保持比例缩小到免费上限，烧录水印、保留可用音频并输出 H.264 MP4。
5. Next.js 把完成的视频流式写入私有 R2，再通过服务端 metadata 检查时长和尺寸，成功后保存结果。
6. 结果页和下载接口先校验所有权，再续签 R2 链接。水印或尺寸处理失败不返回未加水印的 Topaz 文件，并退回额度。

数据库轮询租约防止同一个任务并发执行水印处理。后处理完成的检查点在最终 metadata 查询前保存；临时查询失败后重试时复用已完成的输出。

免费任务提交给 Topaz 的倍率会被限制，例如 1280×720 输入最大使用 1.5×、1920×1080 输入使用 1×增强。后处理再次检查 1080p 上限并添加水印。服务商的内部计算档位、帧率和取整仍会影响费用，不能把输出上限当成固定价格承诺。结果页显示实际输出尺寸；尺寸未增加时不会声称分辨率已提升。

## 本地启动

本机已安装 FFmpeg 和 FFprobe，已把可执行文件及字体路径填入 `.env.local`，没有改动 fal、R2、Google 或 Stripe 密钥。

```sh
pnpm dev
# 或
pnpm build
pnpm start
```

这两个启动命令会同时启动 Next.js 与后处理服务。后处理默认只监听 `127.0.0.1:8789`，每次启动自动生成临时共享密钥；不必申请新的 fal 模型或 API Key。停止启动命令会停止两个子进程。

不要再单独使用 `next start` 来启动完整本地流程，否则后处理服务没有自动启动。`FFMPEG_PATH`、`FFPROBE_PATH`、`VIDEO_WORKER_FONT` 可指定其他路径；留空时使用系统 PATH 与默认字体。

## Cloudflare 部署边界

FFmpeg 不在 Next.js 页面或 Cloudflare SSR 进程内执行。仓库提供 `worker.Dockerfile`，将 CPU 后处理服务部署到支持容器的服务后：

- 用 HTTPS 反向代理暴露该服务，不开放未经认证的处理接口。
- 两端设置相同的高强度 `VIDEO_WORKER_KEY`（至少 32 字符）。
- Next.js 设置 `VIDEO_WORKER_URL=https://你的后处理服务域名`。
- 容器设置 `R2_ACCOUNT_ID`、`R2_BUCKET_NAME`，用于限制裁剪输入只能来自本站存储桶。这两个是存储位置标识，容器不需要 fal 或 R2 访问密钥；访问密钥只保留在 Next.js 服务端，下载使用短期签名 URL。

`GET /health`、`POST /trim` 与 `POST /process` 均需要 Bearer 认证并限流，超限带 `Retry-After`。裁剪只接受本站 R2 上传路径，水印只接受 fal 输出域名。下载禁止重定向并限制大小；FFmpeg 只读取已下载的本地文件，通过参数数组调用而不经过 shell，临时文件在流关闭或失败后清理。

裁剪支持 MP4、MOV、WebM，按完整帧重新编码，保留首个音轨，归一化到 30fps，输出 H.264 MP4。裁剪后用 FFprobe 核对实际长度，超限不会提交增强。裁剪本身没有第三方 API 费用，上线后仍消耗自有服务器 CPU 和存储资源。

Cloudflare 上线使用私有 Container Worker，通过 Service Binding 调用，无公开 HTTP 地址。部署配置为 `cloudflare/video-worker.jsonc`，数据库适配和线上记录见 [Cloudflare 部署](cloudflare-deployment.md)。

## 验证范围

已添加 mock 测试，覆盖默认免费分支、烧录失败、输出上限、并发轮询、完成检查点、R2 私有结果续签、服务认证和限流。代码测试不调用真实 fal，不使用用户试用额度。

根据用户要求，真实 Google 登录、上传、五秒增强、水印视觉效果和下载由用户自行验收；本次不声称已完成真实视频端到端验证。

运行 `node --experimental-strip-types scripts/check-local-trim.mjs` 可执行离线 FFmpeg 集成检查。脚本生成测试画面和音频，并拦截下载为本地数据，不访问 fal/R2，不读取用户视频。2026-11-22 验证：MP4 9.208s → 5.000s、MOV 9.208s → 5.000s、WebM 9.216s → 5.000s，均保持 480×640 并保留音频。
