/**
 * Timing instrumentation for copilot answer latency (docs/design/copilot-first-word.md).
 *
 * Records counts and durations only: never question text, answer text, record titles,
 * tool arguments, or model output.
 */

import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";

export interface CopilotToolTiming {
  readonly tool: string;
  readonly durationMs: number;
}

export interface CopilotRoundTiming {
  readonly round: number;
  readonly durationMs: number;
  readonly toolExecutions: readonly CopilotToolTiming[];
}

export interface CopilotTimingSummary {
  readonly runId: string;
  readonly fastPath: boolean;
  readonly preparationMs: number;
  readonly checksMs: number;
  readonly rounds: readonly CopilotRoundTiming[];
  readonly firstTokenMs: number | null;
  readonly totalServerMs: number;
}

const recentTimings: CopilotTimingSummary[] = [];
const MAX_RECENT_TIMINGS = 50;

function recordTimingSummary(summary: CopilotTimingSummary): void {
  recentTimings.push(summary);
  if (recentTimings.length > MAX_RECENT_TIMINGS) {
    recentTimings.shift();
  }

  const metrics = defaultMetrics();
  if (summary.preparationMs > 0) {
    metrics.observe(METRIC.copilotStageDuration, summary.preparationMs / 1000, {
      stage: "preparation",
    });
  }
  if (summary.checksMs > 0) {
    metrics.observe(METRIC.copilotStageDuration, summary.checksMs / 1000, {
      stage: "checks",
    });
  }
  for (const round of summary.rounds) {
    metrics.observe(METRIC.copilotStageDuration, round.durationMs / 1000, {
      stage: "round",
      round: String(round.round),
    });
    for (const tool of round.toolExecutions) {
      metrics.observe(METRIC.copilotStageDuration, tool.durationMs / 1000, {
        stage: "tool",
        tool: tool.tool,
      });
    }
  }
  if (summary.firstTokenMs !== null && summary.firstTokenMs > 0) {
    metrics.observe(METRIC.copilotStageDuration, summary.firstTokenMs / 1000, {
      stage: "first_token",
    });
  }
  metrics.count(METRIC.copilotTurnsTotal, {
    path: summary.fastPath
      ? "fast_path"
      : summary.rounds.length > 0
        ? "loop"
        : "passages",
  });
}

export function getLastCopilotTiming(): CopilotTimingSummary | null {
  return recentTimings.at(-1) ?? null;
}

export function clearCopilotTimings(): void {
  recentTimings.length = 0;
}

export class CopilotRunTimer {
  readonly runId: string;
  private prepStart = 0;
  private prepEnd = 0;
  private checksStart = 0;
  private checksEnd = 0;
  private currentRound = 0;
  private roundStart = 0;
  private rounds: CopilotRoundTiming[] = [];
  private currentTools: CopilotToolTiming[] = [];
  private toolStart = 0;
  private streamStart = 0;
  private firstTokenTime: number | null = null;
  private readonly startTotal: number;
  private isFastPath = false;

  constructor(runId?: string) {
    this.runId =
      runId ??
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `run-${Date.now()}`);
    this.startTotal = performance.now();
  }

  setFastPath(fast: boolean): void {
    this.isFastPath = fast;
  }

  startPreparation(): void {
    this.prepStart = performance.now();
  }

  endPreparation(): void {
    this.prepEnd = performance.now();
  }

  startChecks(): void {
    this.checksStart = performance.now();
  }

  endChecks(): void {
    this.checksEnd = performance.now();
  }

  startRound(roundIndex = 0): void {
    this.currentRound = roundIndex;
    this.roundStart = performance.now();
    this.currentTools = [];
  }

  startTool(): void {
    this.toolStart = performance.now();
  }

  endTool(toolName: string): void {
    const duration = performance.now() - this.toolStart;
    this.currentTools.push({
      tool: toolName,
      durationMs: Math.round(duration),
    });
  }

  endRound(): void {
    const duration = performance.now() - this.roundStart;
    this.rounds.push({
      round: this.currentRound,
      durationMs: Math.round(duration),
      toolExecutions: [...this.currentTools],
    });
  }

  startStreamWait(): void {
    this.streamStart = performance.now();
  }

  recordFirstToken(): void {
    if (this.firstTokenTime === null && this.streamStart > 0) {
      this.firstTokenTime = Math.round(performance.now() - this.streamStart);
    }
  }

  finish(): CopilotTimingSummary {
    const endTotal = performance.now();
    const summary: CopilotTimingSummary = {
      runId: this.runId,
      fastPath: this.isFastPath,
      preparationMs:
        this.prepEnd > this.prepStart
          ? Math.round(this.prepEnd - this.prepStart)
          : 0,
      checksMs:
        this.checksEnd > this.checksStart
          ? Math.round(this.checksEnd - this.checksStart)
          : 0,
      rounds: [...this.rounds],
      firstTokenMs: this.firstTokenTime,
      totalServerMs: Math.round(endTotal - this.startTotal),
    };
    recordTimingSummary(summary);
    return summary;
  }
}
