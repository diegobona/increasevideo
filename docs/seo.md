# SEO 与原始 HTML 自检

索引范围为 `/`、`/pricing`、`/privacy`、`/terms`。路径清单在 `src/libs/seo.ts`，由 `src/app/sitemap.ts` 输出为 `/sitemap.xml`。`public/robots.txt` 允许抓取并指向生产域名的 sitemap。结果页和支付状态页保留 noindex，不加入 sitemap。

每个页面使用同一 metadata 帮助函数生成独立 canonical、og:title、og:description、og:url 和 og:image。分享图由 `src/app/opengraph-image.tsx` 在构建时生成，地址为 `/opengraph-image`。canonical 始终使用生产域名，过滤预览地址和查询参数；支付会话参数不会进入分享信息。实现遵循 [Next.js 15 Metadata](https://nextjs.org/docs/15/app/api-reference/functions/generate-metadata) 和 [Metadata 文件约定](https://nextjs.org/docs/15/app/api-reference/file-conventions/metadata)。

首页已有 SoftwareApplication 和 FAQPage JSON-LD，未添加 aggregateRating。FAQ 正文仍直接写在 Server Component JSX 中。`public/llms.txt` 描述本站功能并列出四个公开页面；价格及限制由其链接的定价页提供，避免复制配置数字。

## 运行自检

```sh
pnpm lint && pnpm build
pnpm start
```

另开终端：

```sh
node scripts/check-ssr.mjs
# 自定义服务地址
node scripts/check-ssr.mjs --base-url http://127.0.0.1:3002
# 自定义页面列表及关键词
node scripts/check-ssr.mjs --base-url https://preview.example.com --config scripts/ssr-pages.json
```

也可使用 `pnpm check:ssr` 或环境变量 `SSR_BASE_URL`。默认检查 localhost:3000。

配置文件格式：

```json
{
  "canonicalOrigin": "https://increasevideoquality.com",
  "pages": [
    {
      "path": "/",
      "keywords": ["Increase Video Quality", "How much can I upscale a video?"],
      "jsonLdTypes": ["SoftwareApplication", "FAQPage"],
      "disallowAggregateRating": true
    }
  ]
}
```

每项可以用完整 `url` 代替 `path`，也可以用 `canonical` 覆盖预期 canonical。脚本直接 GET 原始 HTML，不运行浏览器 JavaScript；从正文中排除脚本、样式、模板和注释后查找关键词，防止只存在于水合数据或 JSON-LD 的文字误通过。它还检查 HTTP 200、HTML Content-Type、唯一 canonical、Open Graph 字段和 NoScript 占位内容。首页额外检查两种 JSON-LD 及无 aggregateRating。

任何页面请求失败、重定向、超时、关键词或 metadata 缺失均以非零状态退出，并继续报告其他页面结果。该检查验证服务器交付的 HTML，不替代视觉或交互测试。
