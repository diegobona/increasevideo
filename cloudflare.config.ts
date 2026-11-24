import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

export default defineConfig({
  accountId: "c686d583b6d595875de1b8b73462fe42",
  worker: defineWorker({
    name: "increasevideoquality",
    triggers: [
      triggers.fetch({ pattern: "increasevideoquality.com/*", zone: "increasevideoquality.com" }),
    ],
    workersDev: true,
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-23",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ name: "increasevideoquality-db", id: "b9f9bdba-7964-432d-a186-46793967dd42" }),
      VIDEO_SERVICE: bindings.worker({ worker: "increasevideoquality-video" }),
      APP_URL: bindings.text("https://increasevideoquality.com"),
      TRUST_CLOUDFLARE_PROXY: bindings.text("true"),
      VIDEO_WORKER_URL: bindings.text("https://video-worker.internal"),
      FAL_VIDEO_MODEL: bindings.text("topaz/upscale/video/precision"),
      R2_ACCOUNT_ID: bindings.text("c686d583b6d595875de1b8b73462fe42"),
      R2_BUCKET_NAME: bindings.text("video-input"),
      FAL_KEY: bindings.secret(),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      STRIPE_SECRET_KEY: bindings.secret(),
      STRIPE_WEBHOOK_SECRET: bindings.secret(),
      R2_ACCESS_KEY_ID: bindings.secret(),
      R2_SECRET_ACCESS_KEY: bindings.secret(),
      VIDEO_WORKER_KEY: bindings.secret(),
    },
  }),
});
