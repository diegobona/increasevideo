# 结果页验收（2026-10-24）

结果页：`src/app/result/[jobId]/page.tsx` 是动态 Server Component；标题、结果说明、选项说明和再次处理入口都在服务端 HTML 中。只有独立的 `ComparisonPlayer` 负责播放交互。页面设为 noindex/nofollow。

## 数据与鉴权

- 新增 migration `20261023163056_add_result_dimensions`，保留现有数据，仅新增可空的 `resultWidth`、`resultHeight`。本地迁移已应用。
- 任务完成时将服务端读取的实际输出宽高一起落库。不会用原始尺寸乘以选择倍数推测结果，免费输出高度上限可能使该推测失真。
- 已完成的旧任务缺少输出尺寸时，授权成功后由服务端读取并保存一次元数据。
- 创建任务时同时设置 API 路径和结果页路径的 HttpOnly ownerToken cookie；授权查询 API 也会补结果页 cookie，以兼容旧任务。
- 任务不存在或令牌不匹配时，页面调用 `notFound()`。
- 私有 R2 原视频的播放地址在授权后重新签名，避免数据库中的旧链接过期。

## 播放与下载

播放器左右并排，提供同时播放/暂停、共同进度条及增强视频音量开关，不承诺帧级同步。
醒目的下载按钮使用同源下载路由，检查所有权、执行限流并流式返回附件，避免跨域链接的 download 属性被浏览器忽略。
底部 Process another video 链接到 `/#upload`；首页任务完成后也提供结果页入口。

## 已执行的检查

`pnpm test`：48/48 通过。新增检查包括实际输出尺寸、错误令牌、旧结果尺寸补全、下载附件及其授权、R2 播放地址续签；任务集成测试也验证输出尺寸落库和结果页 cookie。

`pnpm lint && pnpm build`：退出码 0，结果页和下载路由成功构建为动态路由。

本地没有 FAL_KEY、FAL_FREE_VIDEO_MODEL、R2 凭据，开发数据库也没有成功的真实任务。因此下面使用独立 SQLite 数据库，通过实际 job handlers + mock provider 完成一次提交和轮询，再进行 SSR 验证。**这不是一次真实 fal/AI 增强验收。** 示例片段只是播放器视觉测试素材。

生成隔离数据的脚本：`scripts/result-smoke-fixture.ts`（必须传入一个不存在的测试数据库路径，不会修改 dev.db）。测试任务：`cmvl73t640000c8t845fike3o`。

以该测试数据库运行 `pnpm start --port 3002 --hostname 127.0.0.1`，用 fixture 的合法 cookie 请求结果页，执行 curl/grep 得到：

```text
Owned result HTTP 200
name="robots" content="noindex, nofollow"
Your video has been enhanced with the 2x upscale setting, resolution increased from 384x216 to 768x432.
Unknown job HTTP 404
Wrong owner HTTP 404
Missing owner HTTP 404
```

同一次浏览器检查点击 Play both / 同时播放后显示 Pause both / 同时暂停；两个本地示例视频均播放到 4 秒结束。预览截图见 [结果页截图](result-page-preview.png)。

真实 fal 任务的结果页及云视频下载验收，仍需先完成 [视频增强模型配置](video-pipeline.md)。
