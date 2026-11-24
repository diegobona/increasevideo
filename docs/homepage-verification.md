# 首页验收记录

验证日期：2026-10-23。

- `pnpm lint && pnpm build` 通过，首页构建标记为动态服务端渲染。
- `pnpm start --hostname 127.0.0.1 --port 3000` 成功启动；首页 HTTP 200。
- 页面响应 HTML 包含实际 `<h1>`、六条 `<summary>` 问题、六个 `<video>` 元素，以及四个使用场景的 524 个英文正文单词。
- canonical 输出为 `https://increasevideoquality.com`；Next.js 自动规范化掉根路径末尾的斜线。
- `SoftwareApplication` 和 `FAQPage` JSON-LD 可解析，六条结构化问题与页面中的 FAQ 完全一致。
- `/privacy`、`/terms`、同步播放脚本及抽查的本地视频文件返回 HTTP 200。
- 浏览器已确认桌面首屏的 H1、上传区、选项、主按钮及免费限制无需滚动即可见；4x 单选和去噪开关可操作，默认值已恢复。案例进入视口后成对播放。
- 仓库内只有 `src/components/UploadCard.tsx` 声明 `use client`；首页及正文不使用 `useEffect`。

## curl | grep 证明

先运行 `pnpm start`。在具备 curl、grep 和 sort 的终端中执行：

```sh
curl -fsS http://127.0.0.1:3000/ | grep -oF -f scripts/homepage-required-text.txt | sort -u
```

Windows PowerShell 验收时使用系统 `curl.exe` 和本机 Git 附带的 `D:\Program Files\Git\usr\bin\grep.exe`；排序使用 `Sort-Object -Unique`。

实际输出（同时保存在 `docs/homepage-curl-results.txt`）：

```text
Are my video files safe?
How it works
How long can a free video be?
How long does a one-minute video take to process?
How much can I upscale a video?
Increase Video Quality
Which video formats are supported?
Will you keep my original video?
```

## 当前功能边界

这是首页和上传前端实现，没有新增 API。服务端的视频元数据校验、上传存储和实际 AI 处理仍需在后端任务中实现；前端的文件检查不能作为服务端信任依据。案例明确标注为模拟输入与参考素材，不宣称真实 AI 增强结果。Contact 链接使用 `hello@increasevideoquality.com`，邮箱服务需上线前配置。
