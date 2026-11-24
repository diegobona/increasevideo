# PVUV 接入

日期：2026-11-24（Asia/Shanghai）。

## 站点与代码

- 已核对 PVUV 中存在 `increasevideoquality.com`，站点 ID `KqU9nfVL`，与用户截图一致，无需重复创建。
- 看板：https://www.pvuv.ai/zh/site?id=KqU9nfVL&period=24h
- 官方脚本：https://www.pvuv.ai/f.js
- 采集地址：https://in.pvuv.ai
- `src/app/layout.tsx` 的 head 中加入 defer 脚本，由所有页面共享，不将页面改为 Client Component。
- 官方脚本原生监听 History API 和 popstate，支持站内客户端路由。
- `data-exclude` 排除 `/result/*`、`/login`、`/payment/*`、`/auth/*` 的页面统计；`data-downloads="off"` 关闭自动文件下载事件。
- 不调用 PVUV 的账号身份识别接口，不添加视频文件或视频地址的自定义事件。
- 隐私页新增 Website analytics 说明。原有站内结果页统计保留。

## 数据范围

PVUV 官方脚本会收集页面 URL（可能含查询参数）、来源、UTM、屏幕/设备/浏览器信息、性能与交互信号，并使用 cookie 和浏览器存储区分访客、会话。采集服务器也会接收到网络连接 IP。

## 当前状态

- `pnpm lint`、`pnpm build`、`pnpm build:vinext` 均通过。
- 用户在获知数据范围与目的地后明确回复“上线！全部允许”，发布授权已完成。
- 已部署至正式域名，应用版本 `ee1e5f1b-4af0-4be3-8568-a2239210ba63`。
- 首页、Video Upscaler、Privacy 的线上原始 HTML 均为 HTTP 200，head 中恰有一条 PVUV 代码，站点 ID、采集域名、下载排除配置正确。Privacy 说明已上线，见 `pvuv-live-check.txt`。
- 线上 SSR 检查 11/11 通过，见 `pvuv-live-ssr.txt`。

## 看板实测

- 使用 Edge 访问正式首页，再点击导航 Video upscaler，未上传视频或提交增强任务。
- PVUV 已从等待安装页面切换为统计看板：1 位访客、1 次会话、2 次浏览量；`/` 与 `/video-upscaler` 各 1 次，访问时长 2 分 2 秒。此为本次验证访问，不代表自然获客。
- 看板显示统计更新时间 2026/11/24 02:37:15，凭证 `pvuv-dashboard-live.jpg`；任务标签页已关闭。
- 本次接入浏览器统计。看板中的 AI/搜索爬虫服务端上报未接入，不属于本次脚本安装。
