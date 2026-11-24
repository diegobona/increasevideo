/* Native video controls keep the content page a Server Component. */
(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const initialize = () => document.querySelectorAll("[data-video-pair]").forEach((group) => {
    if (group.dataset.initialized) return;
    group.dataset.initialized = "true";
    const driver = group.querySelector("[data-driver]");
    const follower = group.querySelector("[data-follower]");
    const button = group.querySelector("[data-compare-toggle]");
    if (!driver || !follower || !button) return;
    let frameHandle;
    let hasPlayed = false;
    const align = () => { if (follower.readyState > 0 && Math.abs(follower.currentTime - driver.currentTime) > 1 / 24) follower.currentTime = driver.currentTime; };
    const trackFrame = () => { align(); if (!driver.paused && "requestVideoFrameCallback" in driver) frameHandle = driver.requestVideoFrameCallback(trackFrame); };
    driver.addEventListener("play", () => {
      hasPlayed = true;
      align();
      follower.play().catch(() => { follower.pause(); });
      button.textContent = "Pause comparison";
      button.setAttribute("aria-pressed", "true");
      if ("requestVideoFrameCallback" in driver) frameHandle = driver.requestVideoFrameCallback(trackFrame);
    });
    driver.addEventListener("pause", () => {
      follower.pause();
      button.textContent = "Play comparison";
      button.setAttribute("aria-pressed", "false");
      if (frameHandle !== undefined && "cancelVideoFrameCallback" in driver) driver.cancelVideoFrameCallback(frameHandle);
    });
    driver.addEventListener("seeking", () => { if (follower.readyState > 0) follower.currentTime = driver.currentTime; });
    driver.addEventListener("timeupdate", align);
    driver.addEventListener("ratechange", () => { follower.playbackRate = driver.playbackRate; });
    follower.addEventListener("loadeddata", () => { align(); if (!driver.paused) follower.play().catch(() => { follower.pause(); }); });
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => { if (driver.paused) driver.play().catch(() => { driver.pause(); }); else driver.pause(); });
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => { entries.forEach((entry) => { if (entry.isIntersecting && !hasPlayed && !reducedMotion) driver.play().catch(() => { driver.pause(); }); else if (!entry.isIntersecting) driver.pause(); }); }, { threshold: 0.25 });
      observer.observe(group);
    }
  });
  initialize();
  // Reconnect comparisons when App Router navigation returns to the home page.
  new MutationObserver(initialize).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) document.querySelectorAll("[data-driver]").forEach((video) => video.pause());
  });
})();
