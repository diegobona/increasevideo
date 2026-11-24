import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import { pricing } from "../../config/pricing";
import { ApiError, checkOrigin, failure, readJson, success } from "../api/http";
import { getAccount } from "../auth/session";
import { createRequestLimiter, rateLimitPolicies } from "../rateLimit";
import { getVisitor, withVisitorCookie } from "../visitor";
import { readCreditBalances } from "../billing/credits";
import { quotePaidResolution, quotePaidVideo } from "../billing/quote";
import { planResolution } from "./resolution";
import { validateVideoUrl } from "./metadata";
import { validateFreeUpload, type VideoMetadata } from "./validate";

export function createMetadataHandler({ database, readMetadata }: {
  database: PrismaClient;
  readMetadata(url: string, signal: AbortSignal): Promise<VideoMetadata>;
}) {
  const limit = createRequestLimiter(database, rateLimitPolicies.metadata);
  return async (request: Request) => {
    const visitor = getVisitor(request);
    try {
      const account = await getAccount(database, request);
      const limited = await limit(request, account?.id ?? visitor.id);
      if (limited) return withVisitorCookie(limited, request, visitor);
      checkOrigin(request);
      if (!account) throw new ApiError(401, "AUTH_REQUIRED", "请先使用 Google 登录，再上传和处理视频");
      const input = await readJson(request);
      const balance = await readCreditBalances(database, account.id);
      if (input.balanceOnly === true) return withVisitorCookie(success({ balance }), request, visitor);
      const url = validateVideoUrl(input.url);
      const metadata = await readMetadata(url, request.signal);
      const paidQuotes = { "2": quotePaidVideo(metadata, 2), "4": quotePaidVideo(metadata, 4) };
      const outputOptions = {
        free: Object.fromEntries(pricing.outputResolutions.map((option) => [option.id, planResolution(metadata, option.id, true)])),
        paid: Object.fromEntries(pricing.outputResolutions.map((option) => [option.id, quotePaidResolution(metadata, option.id)])),
      };
      return withVisitorCookie(success({ ...metadata, balance, paidQuotes, outputOptions, quote: input.scale === 4 ? paidQuotes["4"] : paidQuotes["2"],
        previewDurationSec: Math.min(metadata.durationSec, pricing.free.maxDurationSec),
        validation: validateFreeUpload({ ...metadata, watermark: pricing.free.watermark }) }), request, visitor);
    } catch (error) { return withVisitorCookie(failure(error), request, visitor); }
  };
}
