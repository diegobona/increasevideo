export type EnhancementPhase = "PREPARING" | "QUEUED" | "PROCESSING";
export type EnhancementProgressState = {
  phase: EnhancementPhase;
  startedAt: number;
  phaseStartedAt: number;
};

// Presentation estimates only. Phase changes come from job submission/polling;
// elapsed time can never mark a job complete or start the result player.
const phases = {
  PREPARING: { order: 0, start: 3, ceiling: 24, timeConstantMs: 18_000 },
  QUEUED: { order: 1, start: 25, ceiling: 39, timeConstantMs: 30_000 },
  PROCESSING: { order: 2, start: 40, ceiling: 95, timeConstantMs: 90_000 },
} as const;

export function advanceEnhancementProgress(current: EnhancementProgressState, phase: EnhancementPhase, now: number): EnhancementProgressState {
  if (phases[phase].order <= phases[current.phase].order) return current;
  return { ...current, phase, phaseStartedAt: now };
}

export function estimateEnhancementProgress(state: EnhancementProgressState, now: number): number {
  const { start, ceiling, timeConstantMs } = phases[state.phase];
  const elapsed = Math.max(0, now - state.phaseStartedAt);
  return Math.min(ceiling, start + Math.floor((ceiling - start) * (1 - Math.exp(-elapsed / timeConstantMs))));
}
