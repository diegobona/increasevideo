import { env } from "cloudflare:workers";
import type { VideoService } from "../platform";
export function getVideoService() {
  return (env as unknown as { VIDEO_SERVICE: VideoService }).VIDEO_SERVICE;
}
