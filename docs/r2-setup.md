# R2 配置记录

日期：2026-11-22（Asia/Shanghai）。

- 存储桶：`video-input`，Standard 存储，私有访问。
- 专用 Account API 令牌：`increasevideoquality-video-input`。
- 权限：仅 `video-input` 桶内对象读写；无其他桶或桶管理权限；长期有效。
- S3 Access Key ID、Secret Access Key、账户 ID 和桶名已写入根目录 `.env.local`。密钥不记录在本文中。
- `.gitignore` 已排除 `.env.local`；fal、Google、Stripe 的现有配置均保留。

## 浏览器直传

已保存 CORS：

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://increasevideoquality.com"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match", "Range"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## 实际连接验证

通过项目的 `R2Storage`，使用 24 字节的合成 MP4 文件头验证存储通信；它不是可播放视频，没有调用 fal。

```text
PASS CORS: localhost upload allowed (HTTP 204)
PASS presigned PUT: 24-byte synthetic storage fixture
PASS server HEAD and range GET: size and file signature verified
PASS signed download: exact bytes match
PASS private access: unsigned requests rejected (HTTP 400, InvalidArgument / Authorization)
PASS cleanup: temporary object deleted
```

验证脚本最初把成功预检限定为 200、无签名拒绝限定为 403；实际分别返回 204 和 400。已核实前者为成功预检，后者为缺少 Authorization 的拒绝响应。

本机网络验证使用已有代理 `127.0.0.1:7888`。R2 配置完成不等于 fal 增强流程已经联调；fal 密钥及免费任务水印工作流另见 `video-pipeline.md`。

控制台：[存储桶设置](https://dash.cloudflare.com/c686d583b6d595875de1b8b73462fe42/r2/default/buckets/video-input/settings)、[专用令牌管理](https://dash.cloudflare.com/c686d583b6d595875de1b8b73462fe42/r2/api-tokens)。
