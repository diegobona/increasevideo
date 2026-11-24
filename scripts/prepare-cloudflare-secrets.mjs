import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";

const local = parse(readFileSync(".env.local"));
const stripeFile = ".env.stripe-live.local";
const stripe = existsSync(stripeFile) ? parse(readFileSync(stripeFile)) : {};
const directory = ".wrangler/deployment";
mkdirSync(directory, { recursive: true });
const privateFile = `${directory}/video-secrets.json`;
const video = existsSync(privateFile) ? JSON.parse(readFileSync(privateFile, "utf8")) : { VIDEO_WORKER_KEY: randomBytes(32).toString("hex") };
const app = { ...video };
for (const name of ["FAL_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
  if (!local[name]) throw new Error(`Missing ${name} in .env.local`);
  app[name] = local[name];
}
if (stripe.STRIPE_SECRET_KEY || stripe.STRIPE_WEBHOOK_SECRET) {
  if (!/^(sk|rk)_live_[a-zA-Z0-9]+$/.test(stripe.STRIPE_SECRET_KEY ?? "") ||
      !/^whsec_[a-zA-Z0-9]+$/.test(stripe.STRIPE_WEBHOOK_SECRET ?? "")) {
    throw new Error("Set the live API key and matching webhook signing secret in " + stripeFile);
  }
  app.STRIPE_SECRET_KEY = stripe.STRIPE_SECRET_KEY;
  app.STRIPE_WEBHOOK_SECRET = stripe.STRIPE_WEBHOOK_SECRET;
}
writeFileSync(privateFile, JSON.stringify(video));
writeFileSync(`${directory}/app-secrets.json`, JSON.stringify(app));
console.log("Prepared private deployment input files in ignored .wrangler/deployment; no secret values printed.");
