import type { LiveStreamEvent } from "./behaveLiveStreamTypes";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseLiveStreamLine(jsonLine: string): LiveStreamEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const ev = parsed.event;
  if (ev === "scenario_started") {
    return {
      event: "scenario_started",
      feature: typeof parsed.feature === "string" ? parsed.feature : undefined,
      scenario: typeof parsed.scenario === "string" ? parsed.scenario : undefined,
      location: typeof parsed.location === "string" ? parsed.location : undefined
    };
  }
  if (ev === "scenario_finished") {
    return {
      event: "scenario_finished",
      feature: typeof parsed.feature === "string" ? parsed.feature : undefined,
      scenario: typeof parsed.scenario === "string" ? parsed.scenario : undefined,
      location: typeof parsed.location === "string" ? parsed.location : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined
    };
  }
  if (ev === "feature_finished") {
    return {
      event: "feature_finished",
      feature: typeof parsed.feature === "string" ? parsed.feature : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined
    };
  }
  if (ev === "step_started") {
    return {
      event: "step_started",
      feature: typeof parsed.feature === "string" ? parsed.feature : undefined,
      scenario: typeof parsed.scenario === "string" ? parsed.scenario : undefined,
      location: typeof parsed.location === "string" ? parsed.location : undefined,
      keyword: typeof parsed.keyword === "string" ? parsed.keyword : undefined,
      step: typeof parsed.step === "string" ? parsed.step : undefined
    };
  }
  if (ev === "step_finished") {
    return {
      event: "step_finished",
      feature: typeof parsed.feature === "string" ? parsed.feature : undefined,
      scenario: typeof parsed.scenario === "string" ? parsed.scenario : undefined,
      location: typeof parsed.location === "string" ? parsed.location : undefined,
      keyword: typeof parsed.keyword === "string" ? parsed.keyword : undefined,
      step: typeof parsed.step === "string" ? parsed.step : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      error:
        parsed.error == null
          ? undefined
          : typeof parsed.error === "string"
            ? parsed.error
            : String(parsed.error)
    };
  }
  return undefined;
}

export class NdjsonStdoutBuffer {
  private remainder = "";

  /** Returns complete lines (without trailing \\n). */
  consumeChunk(chunk: string): string[] {
    this.remainder += chunk;
    const parts = this.remainder.split(/\r?\n/);
    this.remainder = parts.pop() ?? "";
    return parts.filter((p) => p.length > 0);
  }

  flushLine(): string | undefined {
    const t = this.remainder.trim();
    this.remainder = "";
    return t.length > 0 ? t : undefined;
  }
}
