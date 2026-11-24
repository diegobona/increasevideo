FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/video-worker.mjs scripts/video-worker.mjs
COPY src/config/pricing.ts src/config/pricing.ts
ENV VIDEO_WORKER_HOST=0.0.0.0 VIDEO_WORKER_PORT=8789
USER node
EXPOSE 8789
CMD ["node", "--experimental-strip-types", "scripts/video-worker.mjs"]
