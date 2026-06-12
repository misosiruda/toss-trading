export interface ReplaySessionWindow {
  startTime: string;
  endTime: string;
  timezoneOffsetMinutes: number;
  weekdaysOnly?: boolean;
}

export interface SimulatedClockOptions {
  startAt: Date;
  endAt: Date;
  stepSeconds: number;
  speedMultiplier?: number;
  session?: ReplaySessionWindow;
}

export interface SimulatedTick {
  stepIndex: number;
  simulatedAt: string;
  epochMs: number;
}

export interface SimulatedClockMetadata {
  startAt: string;
  endAt: string;
  stepSeconds: number;
  speedMultiplier: number;
  session?: ReplaySessionWindow;
}

export class SimulatedClock {
  private readonly speedMultiplier: number;

  constructor(private readonly options: SimulatedClockOptions) {
    validateClockOptions(options);
    this.speedMultiplier = options.speedMultiplier ?? 1;
  }

  ticks(): SimulatedTick[] {
    const ticks: SimulatedTick[] = [];
    const startMs = this.options.startAt.getTime();
    const endMs = this.options.endAt.getTime();
    const stepMs = this.options.stepSeconds * 1000;
    let stepIndex = 0;

    for (let currentMs = startMs; currentMs <= endMs; currentMs += stepMs) {
      const simulatedAt = new Date(currentMs);
      if (isWithinReplaySession(simulatedAt, this.options.session)) {
        ticks.push({
          stepIndex,
          simulatedAt: simulatedAt.toISOString(),
          epochMs: currentMs
        });
      }
      stepIndex += 1;
    }

    return ticks;
  }

  metadata(): SimulatedClockMetadata {
    const metadata: SimulatedClockMetadata = {
      startAt: this.options.startAt.toISOString(),
      endAt: this.options.endAt.toISOString(),
      stepSeconds: this.options.stepSeconds,
      speedMultiplier: this.speedMultiplier
    };

    if (this.options.session !== undefined) {
      metadata.session = this.options.session;
    }

    return metadata;
  }
}

export function isWithinReplaySession(
  simulatedAt: Date,
  session?: ReplaySessionWindow
): boolean {
  if (session === undefined) {
    return true;
  }

  const local = new Date(
    simulatedAt.getTime() + session.timezoneOffsetMinutes * 60_000
  );
  const day = local.getUTCDay();
  if (session.weekdaysOnly === true && (day === 0 || day === 6)) {
    return false;
  }

  const currentMinute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const startMinute = parseSessionTime(session.startTime, "startTime");
  const endMinute = parseSessionTime(session.endTime, "endTime");

  if (startMinute <= endMinute) {
    return currentMinute >= startMinute && currentMinute <= endMinute;
  }

  return currentMinute >= startMinute || currentMinute <= endMinute;
}

function validateClockOptions(options: SimulatedClockOptions): void {
  if (!Number.isFinite(options.startAt.getTime())) {
    throw new Error("startAt must be a valid date");
  }
  if (!Number.isFinite(options.endAt.getTime())) {
    throw new Error("endAt must be a valid date");
  }
  if (options.startAt.getTime() > options.endAt.getTime()) {
    throw new Error("startAt must be before or equal to endAt");
  }
  if (!Number.isInteger(options.stepSeconds) || options.stepSeconds <= 0) {
    throw new Error("stepSeconds must be a positive integer");
  }
  const speedMultiplier = options.speedMultiplier ?? 1;
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    throw new Error("speedMultiplier must be positive");
  }
  if (options.session !== undefined) {
    parseSessionTime(options.session.startTime, "startTime");
    parseSessionTime(options.session.endTime, "endTime");
    if (!Number.isInteger(options.session.timezoneOffsetMinutes)) {
      throw new Error("timezoneOffsetMinutes must be an integer");
    }
  }
}

function parseSessionTime(value: string, label: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`${label} must use HH:mm`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`${label} must use HH:mm`);
  }
  return hour * 60 + minute;
}
