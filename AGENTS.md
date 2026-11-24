## 项目
- 名称：increasevideoquality.com
- 目标：一个视频画质提升工具站，核心关键词 increase video quality
- 技术栈：Next.js 15 App Router + TypeScript + Tailwind + SQLlite(上线后用cloudflare的D1) + Cloudflare R2 + Stripe
- 部署：Cloudflare Workers + D1 + R2，必须支持 SSR（用户于 2026-11-23 确认从 Pages 改为 Workers）

## 硬性约束（违反即为 bug）
1. 所有页面的 H1、正文、案例描述、FAQ、价格文案，必须在服务端渲染进 HTML。
 只有上传框的交互逻辑可以是 Client Component。
 禁止使用 useEffect 之后才渲染正文内容的写法。
2. 不允许出现 "use client" 的整页组件。页面本身必须是 Server Component，
 交互部分拆成单独的小 Client Component。
3. 任何用户可见的价格、额度、时长限制，都写进 src/config/pricing.ts 单一来源，
 不允许在组件里硬编码。
4. 上传视频的时长与分辨率必须以服务端校验为准，前端传上来的值只作展示。
5. 所有对外 API 路由必须做限流，不允许裸奔。

## 代码约定
- 目录：src/app 放路由，src/libs 放 db/r2/stripe/video 等客户端，src/components 放组件
- 每个 API route 返回 { ok: boolean, data?: T, error?: string }
- 不允许引入未在 package.json 中声明的依赖

## 验收
每次改完运行：pnpm lint && pnpm build
