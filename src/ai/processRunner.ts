import { spawn } from "node:child_process";

export const PROCESS_RUN_LIMITS = Object.freeze({
  maxStdoutBytes: 8 * 1024 * 1024,
  maxStderrBytes: 256 * 1024,
  terminationGraceMs: 1000,
  killGraceMs: 1000
});

export interface ProcessRunOptions {
  stdin?: string;
  timeoutMs: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  terminationGraceMs?: number;
  killGraceMs?: number;
}

export type ProcessRunFailure =
  | "timeout" | "stdout_limit" | "stderr_limit" | "spawn_failed" | "process_error";

export interface ProcessRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  // Optional for existing injected runners. NodeProcessRunner always reports termination.
  failureReason?: ProcessRunFailure;
  termination?: "closed" | "not_started" | "unconfirmed";
  terminationRequestFailed?: boolean;
}

export interface ProcessRunner {
  run(command: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult>;
}

/** Direct child only: a close receipt never attests to descendant process cleanup. */
export class NodeProcessRunner implements ProcessRunner {
  async run(command: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
    const limits = {
      timeoutMs: boundedInteger(options.timeoutMs, 2_147_483_647),
      maxStdoutBytes: boundedInteger(options.maxStdoutBytes ?? PROCESS_RUN_LIMITS.maxStdoutBytes, 64 * 1024 * 1024),
      maxStderrBytes: boundedInteger(options.maxStderrBytes ?? PROCESS_RUN_LIMITS.maxStderrBytes, 64 * 1024 * 1024),
      terminationGraceMs: boundedInteger(options.terminationGraceMs ?? PROCESS_RUN_LIMITS.terminationGraceMs, 60_000),
      killGraceMs: boundedInteger(options.killGraceMs ?? PROCESS_RUN_LIMITS.killGraceMs, 60_000)
    };
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, args, { stdio: "pipe", windowsHide: true, shell: false });
      } catch {
        resolve({ exitCode: null, stdout: "", stderr: "", timedOut: false,
          failureReason: "spawn_failed", termination: "not_started", terminationRequestFailed: false });
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let exited = false;
      let failureReason: ProcessRunFailure | undefined;
      let terminationRequestFailed = false;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const executionTimer = setTimeout(() => stop("timeout"), limits.timeoutMs);

      function finish(termination: NonNullable<ProcessRunResult["termination"]>, exitCode: number | null): void {
        if (settled) return;
        settled = true;
        clearTimeout(executionTimer);
        clearTimeout(graceTimer);
        clearTimeout(killTimer);
        child.stdout?.off("data", onStdout);
        child.stderr?.off("data", onStderr);
        child.off("exit", onExit);
        child.off("close", onClose);
        // Guard late errors: destroying a pipe may emit an asynchronous error.
        if (termination !== "closed") {
          child.stdin?.destroy();
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
        }
        resolve({ exitCode, stdout: failureReason ? "" : Buffer.concat(stdout).toString("utf8"),
          stderr: failureReason ? "" : Buffer.concat(stderr).toString("utf8"),
          timedOut: failureReason === "timeout", ...(failureReason ? { failureReason } : {}),
          termination, terminationRequestFailed });
        stdout.length = 0;
        stderr.length = 0;
      }

      function requestSignal(signal: NodeJS.Signals): void {
        // Avoid signalling an exited PID even if inherited pipes remain open.
        if (settled || exited || child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
        try {
          if (!child.kill(signal)) terminationRequestFailed = true;
        } catch { terminationRequestFailed = true; }
      }

      function stop(reason: ProcessRunFailure): void {
        if (settled || failureReason) return;
        failureReason = reason;
        stdout.length = 0;
        stderr.length = 0;
        clearTimeout(executionTimer);
        graceTimer = setTimeout(() => {
          killTimer = setTimeout(() => finish("unconfirmed", child.exitCode), limits.killGraceMs);
          requestSignal("SIGKILL");
        }, limits.terminationGraceMs);
        requestSignal("SIGTERM");
      }

      function collect(chunk: Buffer, stream: "stdout" | "stderr"): void {
        if (settled || failureReason) return;
        const size = stream === "stdout" ? stdoutBytes : stderrBytes;
        const maximum = stream === "stdout" ? limits.maxStdoutBytes : limits.maxStderrBytes;
        if (chunk.length > maximum - size) { stop(stream === "stdout" ? "stdout_limit" : "stderr_limit"); return; }
        if (stream === "stdout") { stdoutBytes += chunk.length; stdout.push(chunk); }
        else { stderrBytes += chunk.length; stderr.push(chunk); }
      }
      function onStdout(chunk: Buffer): void { collect(chunk, "stdout"); }
      function onStderr(chunk: Buffer): void { collect(chunk, "stderr"); }
      function onExit(): void { exited = true; }
      function onClose(code: number | null): void { finish("closed", code); }
      function onError(): void {
        if (settled) return;
        if (child.pid === undefined) {
          failureReason = "spawn_failed";
          finish("not_started", null);
        } else if (failureReason) { terminationRequestFailed = true; }
        else { stop("process_error"); }
      }
      child.stdout!.on("data", onStdout);
      child.stderr!.on("data", onStderr);
      child.stdout!.on("error", () => stop("process_error"));
      child.stderr!.on("error", () => stop("process_error"));
      child.stdin!.on("error", () => stop("process_error"));
      child.on("error", onError);
      child.on("exit", onExit);
      child.on("close", onClose);
      child.stdin!.end(options.stdin);
    });
  }
}

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error("invalid process execution limit");
  }
  return value;
}
