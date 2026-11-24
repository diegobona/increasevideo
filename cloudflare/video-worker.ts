import { Container } from "@cloudflare/containers";

interface Environment {
  VIDEO_CONTAINER: DurableObjectNamespace<VideoContainer>;
  VIDEO_WORKER_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
}

export class VideoContainer extends Container<Environment> {
  defaultPort = 8789;
  sleepAfter = "1m";
  envVars: Record<string, string> = {
    VIDEO_WORKER_KEY: this.env.VIDEO_WORKER_KEY,
    R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID,
    R2_BUCKET_NAME: this.env.R2_BUCKET_NAME,
  };
}

// Private service binding only: no public workers.dev endpoint or route.
const videoWorker = {
  async fetch(request: Request, env: Environment): Promise<Response> {
    if (!env.VIDEO_WORKER_KEY || request.headers.get("authorization") !== `Bearer ${env.VIDEO_WORKER_KEY}`) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return env.VIDEO_CONTAINER.get(env.VIDEO_CONTAINER.idFromName("video-processing")).fetch(request);
  },
};

export default videoWorker;
