import "server-only";
import type { PrismaClient, VideoJob } from "../../generated/prisma/client";
import { createId } from "@paralleldrive/cuid2";
import { atomicD1, getD1, statement, type SqlStatement } from "../db/d1";
import { pricing } from "../../config/pricing";
import { ApiError, checkOrigin, failure, readJson, success } from "../api/http";
import { createDistributedLimiter } from "../api/distributed-limit";
import { createRequestLimiter, rateLimitPolicies } from "../rateLimit";
import { getVisitor, withVisitorCookie } from "../visitor";
import { readCreditBalances, refundJobCredits, reserveJobCredits } from "../billing/credits";
import { getAccount } from "../auth/session";
import { quotePaidVideo } from "../billing/quote";
import { validateVideoUrl } from "./metadata";
import type { VideoProvider } from "./provider";
import { fitsResolution, validateFreeUpload, validateFreeVideo, validatePaidVideo, type VideoMetadata } from "./validate";
import { trimFreeVideo } from "./trim";
import { ownsJob, readOwnerToken, setResultCookie } from "./ownership";
import { isOutputResolution, planResolution } from "./resolution";
import { isResultVariant, quoteResultVariant } from "./continuation";
import { isR2Url, R2Storage } from "../r2/client";
import { storedFileExpiry } from "./retention";

type Dependencies = {
  database: PrismaClient; provider: VideoProvider; readMetadata(url: string): Promise<VideoMetadata>;
  trimVideo?(url: string, durationSec: number): Promise<string>;
  refreshSource?(url: string): Promise<string>;
};
type Context = { params: Promise<{ id: string }> };

async function jobStatusResponse(job: VideoJob, requestUrl: string) {
  if (job.resultExpiresAt && job.resultExpiresAt.getTime() <= Date.now()) throw new ApiError(410, "RESULT_EXPIRED", "This video's download period has ended.");
  let resultUrl = job.resultUrl;
  if (resultUrl && isR2Url(resultUrl)) resultUrl = await new R2Storage().refreshDownloadUrl(resultUrl);
  return setResultCookie(success({ status: job.status, resultWidth: job.resultWidth, resultHeight: job.resultHeight,
    processedDurationSec: job.processedDurationSec, ...(resultUrl ? { resultUrl } : {}),
    ...(job.resultExpiresAt ? { resultExpiresAt: job.resultExpiresAt } : {}), ...(job.errorMessage ? { error: job.errorMessage } : {}) }),
  requestUrl, job.id, job.ownerToken);
}

export function createJobHandlers({ database, provider, readMetadata, trimVideo = trimFreeVideo,
  refreshSource = async (url) => isR2Url(url) ? new R2Storage().refreshDownloadUrl(url) : url,
}: Dependencies) {
  const createLimit = createRequestLimiter(database, rateLimitPolicies.jobs);
  const pollLimit = createDistributedLimiter(database, "jobs:poll", pricing.api.jobsPollPerMinute);

  async function failAndRefund(id: string, error: string, pollToken?: string) {
    if (getD1(database)) return atomicD1(database, async () => {
      const job = await database.videoJob.findUnique({ where: { id } });
      const statements: SqlStatement[] = [];
      if (job && ["PENDING", "PROCESSING"].includes(job.status) && (!pollToken || job.pollToken === pollToken)) {
        statements.push(statement('UPDATE VideoJob SET status = ?, errorMessage = ?, updatedAt = ? WHERE id = ?', "FAILED", error, new Date().toISOString(), id));
        await refundJobCredits(database, job.visitorId, id, statements);
      }
      return { statements, result: undefined };
    });
    return database.$transaction(async (tx) => {
      const changed = await tx.videoJob.updateMany({
        where: { id, ...(pollToken ? { pollToken } : {}), status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "FAILED", errorMessage: error },
      });
      if (changed.count) {
        const job = await tx.videoJob.findUniqueOrThrow({ where: { id } });
        await refundJobCredits(tx, job.visitorId, id);
      }
    });
  }

  return {
    async POST(request: Request) {
      const visitor = getVisitor(request);
      try {
        const account = await getAccount(database, request);
        const limited = await createLimit(request, account?.id ?? visitor.id);
        if (limited) return withVisitorCookie(limited, request, visitor);
        checkOrigin(request);
        if (!account) throw new ApiError(401, "AUTH_REQUIRED", "请先使用 Google 登录，再上传和处理视频");
        const input = await readJson(request);
        const variant = input.sourceJobId !== undefined ? input.variant : undefined;
        if (input.sourceJobId !== undefined) {
          if (typeof input.sourceJobId !== "string" || !/^[\w-]{1,128}$/.test(input.sourceJobId) || !isResultVariant(variant)) {
            throw new ApiError(400, "INVALID_VARIANT", "请选择支持的处理档位");
          }
          const source = await database.videoJob.findUnique({ where: { id: input.sourceJobId } });
          if (!source || source.visitorId !== account.id) throw new ApiError(403, "FORBIDDEN", "无权重新处理此视频");
          if (source.status !== "SUCCEEDED") throw new ApiError(409, "RESULT_NOT_READY", "请等待当前任务完成");
          if (!Number.isSafeInteger(input.maxCredits) || (input.maxCredits as number) < 1) throw new ApiError(400, "QUOTE_REQUIRED", "请先查看本次处理所需额度");
          input.url = await refreshSource(source.originalUrl);
          input.resolution = variant === "denoise" ? undefined : variant;
          input.scale = variant === "denoise" ? 1 : undefined;
          input.denoise = variant === "denoise" || source.denoise;
          input.tier = "PAID";
        }
        const url = validateVideoUrl(input.url);
        if (input.resolution !== undefined ? !isOutputResolution(input.resolution)
          : variant !== "denoise" && (typeof input.scale !== "number" || !pricing.enhancement.scales.some((scale) => scale === input.scale))) {
          throw new ApiError(400, "INVALID_RESOLUTION", "请选择支持的输出分辨率");
        }
        if (typeof input.denoise !== "boolean") throw new ApiError(400, "INVALID_DENOISE", "去噪选项必须为布尔值");
        if (input.tier !== undefined && input.tier !== "FREE" && input.tier !== "PAID") throw new ApiError(400, "INVALID_TIER", "请选择免费或付费处理");
        const { denoise } = input;
        const resolution = isOutputResolution(input.resolution) ? input.resolution : undefined;
        const visitorId = account.id;
        const paid = input.tier === "PAID";
        const balance = await readCreditBalances(database, visitorId);
        if ((paid ? balance.paidCredits : balance.freeCredits) < 1) throw new ApiError(402, "INSUFFICIENT_CREDITS", paid ? "付费时长不足，请购买时长包后继续处理" : "免费额度已用完，请升级后继续处理");
        const watermark = paid ? pricing.paid.watermark : pricing.free.watermark;
        await provider.assertConfigured?.(watermark);
        const metadata = await readMetadata(url);
        const output = resolution ? planResolution(metadata, resolution, !paid) : null;
        if (output && !output.ok) throw new ApiError(422, output.code, output.error);
        const scale = output?.ok ? output.scale : input.scale as number;
        const validation = paid ? quotePaidVideo(metadata, scale) : validateFreeUpload({ ...metadata, watermark });
        if (!validation.ok) throw new ApiError(422, validation.code, validation.error);
        const cost = "creditsRequired" in validation ? validation.creditsRequired : pricing.enhancement.creditsPerJob;
        if (isResultVariant(variant)) {
          const verifiedQuote = quoteResultVariant(metadata, variant);
          if (!verifiedQuote.ok) throw new ApiError(422, verifiedQuote.code, verifiedQuote.error);
          if (cost > (input.maxCredits as number)) throw new ApiError(409, "QUOTE_CHANGED", "视频参数已更新，所需额度高于页面报价。请刷新页面后重试，尚未扣费。");
        }
        const processedDurationSec = paid ? metadata.durationSec : Math.min(metadata.durationSec, pricing.free.maxDurationSec);
        const ownerToken = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const jobData = {
            originalUrl: url, originalDurationSec: metadata.durationSec, originalWidth: metadata.width, originalHeight: metadata.height,
            processedDurationSec,
            originalFps: metadata.fps, billingVersion: paid ? pricing.paid.billingVersion : 0,
            scale, denoise, visitorId, ownerToken, isFreeTier: !paid, watermark,
        };
        const job = getD1(database) ? await atomicD1(database, async () => {
          const id = createId();
          const data = { id, ...jobData, originalFps: jobData.originalFps ?? null, updatedAt: new Date().toISOString() };
          const keys = Object.keys(data);
          const statements = [statement(`INSERT INTO VideoJob (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...Object.values(data).map((value) => typeof value === "boolean" ? Number(value) : value))];
          await reserveJobCredits(database, visitorId, id, cost, paid, new Date(), statements);
          return { statements, result: { id } };
        }) : await database.$transaction(async (tx) => {
          const created = await tx.videoJob.create({ data: jobData });
          // The job write takes the SQLite writer lock before reading the balance.
          // A conditional debit and its job record commit or roll back together.
          await reserveJobCredits(tx, visitorId, created.id, cost, paid);
          return created;
        });
        let submitted: { jobId: string };
        const submissionStages = {
          trim: { code: "VIDEO_TRIM_FAILED", message: "试用片段裁剪失败" },
          metadata: { code: "CLIP_METADATA_FAILED", message: "裁剪后的视频参数读取失败" },
          validation: { code: "TRIAL_CLIP_INVALID", message: "裁剪后的视频未通过试用范围校验" },
          resolution: { code: "TRIAL_OUTPUT_RESOLUTION", message: "无法生成所选的输出分辨率" },
          submit: { code: "PROVIDER_SUBMIT_FAILED", message: "视频增强任务提交失败" },
        };
        let stage: keyof typeof submissionStages = "submit";
        let clip: VideoMetadata | undefined;
        try {
          let videoUrl = url;
          let enhancementMetadata = metadata;
          if (!paid && metadata.durationSec > processedDurationSec) {
            stage = "trim";
            videoUrl = validateVideoUrl(await trimVideo(url, processedDurationSec));
            stage = "metadata";
            const clipped = await readMetadata(videoUrl);
            clip = clipped;
            stage = "validation";
            // Never pay to enhance the full upload if trimming failed or was ignored.
            if (clipped.durationSec > processedDurationSec) {
              throw new ApiError(502, "TRIAL_CLIP_DURATION", `系统未能将试用片段裁剪至 ${processedDurationSec} 秒，裁剪结果仍为 ${clipped.durationSec.toFixed(3)} 秒`);
            }
            const clipValidation = validateFreeVideo({ ...clipped, watermark });
            if (!clipValidation.ok) {
              throw new ApiError(502, "TRIAL_CLIP_INVALID", `裁剪后的视频校验失败：${clipValidation.error}`);
            }
            enhancementMetadata = clipped;
          }
          // Bound the requested output before inference, using the actual clip dimensions.
          stage = "resolution";
          const clipOutput = resolution && !paid ? planResolution(enhancementMetadata, resolution, true) : null;
          if (clipOutput && !clipOutput.ok) throw new ApiError(502, "TRIAL_OUTPUT_RESOLUTION", clipOutput.error);
          const providerScale = paid ? scale : clipOutput?.ok ? clipOutput.scale : Math.floor(Math.min(scale,
            pricing.free.maxOutputWidth / Math.max(enhancementMetadata.width, enhancementMetadata.height),
            pricing.free.maxOutputHeight / Math.min(enhancementMetadata.width, enhancementMetadata.height)) * 1_000_000) / 1_000_000;
          stage = "submit";
          submitted = await provider.submitUpScale({ videoUrl, scale: providerScale, denoise, watermark });
        }
        catch (error) {
          const code = error instanceof ApiError ? error.code : submissionStages[stage].code;
          const reason = error instanceof ApiError ? error.message : submissionStages[stage].message;
          // Persist a useful failure and log only measured fields. Raw provider
          // errors can contain credentials or signed video URLs, so never log them.
          const measurements = (value: VideoMetadata) => ({ durationSec: value.durationSec, width: value.width, height: value.height });
          console.error("video_job_submission_failed", {
            jobId: job.id, stage, code, original: measurements(metadata),
            ...(clip ? { clip: measurements(clip) } : {}), processedDurationSec,
          });
          const message = `${reason}；额度已退回，请重试（${code}）`;
          await failAndRefund(job.id, message);
          throw new ApiError(502, code, message);
        }
        await database.videoJob.update({ where: { id: job.id }, data: { providerJobId: submitted.jobId } });
        const response = success({ jobId: job.id, creditsCharged: cost, tier: paid ? "PAID" : "FREE", processedDurationSec });
        response.headers.append("Set-Cookie", `ownerToken=${ownerToken}; Path=/api/jobs/${job.id}; HttpOnly; SameSite=Lax; Max-Age=2592000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
        return withVisitorCookie(setResultCookie(response, request.url, job.id, ownerToken), request, visitor);
      } catch (error) { return withVisitorCookie(failure(error), request, visitor); }
    },

    async GET(request: Request, context: Context) {
      const limited = await pollLimit(request);
      if (limited) return limited;
      try {
        const { id } = await context.params;
        if (!/^[\w-]{1,128}$/.test(id)) throw new ApiError(400, "INVALID_JOB", "任务标识无效");
        const job = await database.videoJob.findUnique({ where: { id } });
        const token = readOwnerToken(request);
        if (!job || !ownsJob(job.ownerToken, token)) {
          throw new ApiError(403, "FORBIDDEN", "无权查看此视频任务");
        }
        if (job.status === "SUCCEEDED" || job.status === "FAILED" || !job.providerJobId) {
          return await jobStatusResponse(job, request.url);
        }
        const pollToken = crypto.randomUUID();
        const lease = await database.videoJob.updateMany({ where: {
          id, status: { in: ["PENDING", "PROCESSING"] },
          OR: [{ pollLeaseUntil: null }, { pollLeaseUntil: { lt: new Date() } }],
        }, data: { pollToken, pollLeaseUntil: new Date(Date.now() + 300_000) } });
        if (!lease.count) return setResultCookie(success({ status: "PROCESSING" }), request.url, id, job.ownerToken);
        try {
          // Re-read after acquiring the shared lease: another process may have
          // already persisted a completed watermark checkpoint.
          const current = await database.videoJob.findUniqueOrThrow({ where: { id } });
          const update = await provider.getJobStatus(current.providerJobId!);
          if (update.checkpoint) await database.videoJob.updateMany({ where: { id, pollToken }, data: { providerJobId: update.checkpoint } });
          if (update.status === "FAILED") await failAndRefund(id, update.error || "视频增强失败，额度已退回", pollToken);
          else if (update.status === "SUCCEEDED") {
            const resultUrl = validateVideoUrl(update.resultUrl);
            const actual = await readMetadata(resultUrl);
            const validation = job.isFreeTier ? validateFreeVideo({ ...actual, watermark: job.watermark }) : validatePaidVideo(actual);
            const expected = !job.isFreeTier ? quotePaidVideo({ durationSec: job.originalDurationSec, width: job.originalWidth, height: job.originalHeight, fps: job.originalFps ?? undefined }, job.scale) : null;
            const exceedsPaidQuote = expected && (!expected.ok || !fitsResolution(actual.width, actual.height, expected.outputWidth, expected.outputHeight)
              || actual.durationSec > job.originalDurationSec + 1 / (job.originalFps || pricing.paid.maxFps));
            const exceedsFreeClip = job.isFreeTier && actual.durationSec > (job.processedDurationSec ?? pricing.free.maxDurationSec);
            if (!validation.ok || exceedsPaidQuote || exceedsFreeClip) await failAndRefund(id, "增强结果超出已校验的处理范围，额度已退回", pollToken);
            else await database.videoJob.updateMany({
              where: { id, pollToken, status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "SUCCEEDED", resultUrl, resultWidth: actual.width, resultHeight: actual.height,
                resultExpiresAt: update.resultExpiresAt ?? storedFileExpiry(resultUrl, "results") },
            });
          } else await database.videoJob.updateMany({
            where: { id, pollToken, status: update.status === "PENDING" ? "PENDING" : { in: ["PENDING", "PROCESSING"] } },
            data: { status: update.status },
          });
          const saved = await database.videoJob.findUniqueOrThrow({ where: { id } });
          return await jobStatusResponse(saved, request.url);
        } finally {
          await database.videoJob.updateMany({ where: { id, pollToken }, data: { pollToken: null, pollLeaseUntil: null } });
        }
      } catch (error) { return failure(error); }
    },
  };
}
