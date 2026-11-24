# fal 五秒试用计费核对

核对日期：2026-11-22。只读查阅官方文档和价格接口，未提交真实视频增强任务。

- 本站使用 `topaz/upscale/video/precision` 的 Proteus 模型。
- [fal 接口文档](https://fal.ai/models/topaz/upscale/video/precision/api) 接收视频 URL，没有必须满十秒的要求。公开文档只列出最长五分钟；五秒片段按普通视频提交。尚未做真实任务验收。
- [fal 模型价格](https://fal.ai/models/topaz/upscale/video/precision/llms.txt) 给出的 30fps 示例：1080p、十秒为 USD 0.20，一分钟为 USD 0.80。每个任务取整一次，所以不能把十秒价格线性除以二，当成五秒的确定实扣价。
- 已认证只读 `GET https://api.fal.ai/v1/models/pricing?endpoint_id=topaz/upscale/video/precision` 返回 HTTP 200，`unit_price: 0.01, unit: units, currency: USD`。单位不是秒，无法仅用这条响应换算五秒价格。
- [Topaz Proteus 官方说明](https://developer.topazlabs.com/video-models/upscaling-and-enhancement/precision/proteus.md) 还说明内部计算采用 1×、2×、4×档位；例如 720p 到 1080p 的 1.5×输出可按 2×内部计算。这是 Topaz 自身规则，不应直接当作 fal 的美元账单。
- 当前免费输出提高到 1920×1080，服务端根据实际裁剪片段计算受限倍率，再提交 fal；仍处理前五秒且必须带水印。费用还受输入、帧率、模型档位和取整影响。

五秒实际费用以用户之后试跑的 fal 请求账单为准；目前不承诺固定 USD 0.10。
