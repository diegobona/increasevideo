"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recommendationPaths } from "@/libs/video/continuation";

const key = "result-engagement";
type Visit = { jobId: string; sessionId: string; target?: string; updatedAt: number };
function loadVisit(): Visit | undefined {
  try { return JSON.parse(sessionStorage.getItem(key) || "null") ?? undefined; } catch { return undefined; }
}
function saveVisit(visit: Visit) { try { sessionStorage.setItem(key, JSON.stringify(visit)); } catch { /* Tracking never blocks the tool. */ } }

export default function ResultEngagementTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const section = document.querySelector<HTMLElement>("[data-result-extension]");
    const previous = loadVisit();
    const jobId = section?.dataset.jobId;
    let visit: Visit;
    if (jobId) {
      visit = { jobId, sessionId: previous?.jobId === jobId ? previous.sessionId : crypto.randomUUID(), updatedAt: Date.now() };
    } else if (previous?.target === pathname && recommendationPaths.includes(pathname) && Date.now() - previous.updatedAt < 30 * 60_000) {
      visit = { ...previous, updatedAt: Date.now() };
    } else return;
    saveVisit(visit);
    const endpoint = `/result/${encodeURIComponent(visit.jobId)}/events`;
    const send = (eventType: string, data: object = {}, id = crypto.randomUUID()) => {
      const body = JSON.stringify({ id, sessionId: visit.sessionId, eventType, path: pathname, ...data });
      if (navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }))) return;
      void fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    };
    send("result_page_view");
    let visibleSince: number | null = document.visibilityState === "visible" ? performance.now() : null;
    let visibleMs = 0;
    const dwellId = crypto.randomUUID();
    const flush = () => {
      const now = performance.now();
      if (visibleSince !== null) visibleMs += now - visibleSince;
      visibleSince = document.visibilityState === "visible" ? now : null;
      send("result_visible_time", { durationMs: Math.min(86_400_000, Math.floor(visibleMs)) }, dwellId);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else {
        visibleSince = performance.now();
        const bounds = section?.getBoundingClientRect();
        if (bounds && bounds.bottom > 0 && bounds.top < window.innerHeight) impression();
      }
    };
    const onPageHide = () => { flush(); visibleSince = null; };
    const onPageShow = () => { visibleSince = document.visibilityState === "visible" ? performance.now() : null; };
    let impressed = false;
    const impression = () => {
      if (!impressed && document.visibilityState === "visible") { impressed = true; send("result_extension_impression"); }
    };
    const observer = section ? new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) impression();
    }, { threshold: 0.1 }) : undefined;
    if (section) observer?.observe(section);
    const click = (event: MouseEvent) => {
      const target = (event.target as Element).closest<HTMLElement>("[data-result-target]");
      if (!target || !section?.contains(target) || target instanceof HTMLButtonElement && target.disabled) return;
      const value = target.dataset.resultTarget!;
      impression();
      send("result_extension_click", { target: value });
      if (recommendationPaths.includes(value)) saveVisit({ ...visit, target: value, updatedAt: Date.now() });
    };
    document.addEventListener("click", click);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    const timer = window.setInterval(flush, 15_000);
    return () => {
      flush(); clearInterval(timer); observer?.disconnect();
      document.removeEventListener("click", click);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [pathname]);
  return null;
}
