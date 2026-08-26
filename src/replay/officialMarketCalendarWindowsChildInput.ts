import type { Writable } from "node:stream";

export async function writeOfficialMarketCalendarWindowsHelperInput(
  stream: Writable,
  value: string,
  end = false
): Promise<boolean> {
  if (stream.destroyed || stream.errored !== null) return false;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (succeeded: boolean) => {
      if (settled) return;
      settled = true;
      resolve(succeeded);
    };
    try {
      const callback = (error?: Error | null) => {
        settle(error == null && stream.errored === null);
      };
      if (end) {
        stream.end(value, callback as () => void);
      } else {
        stream.write(value, callback);
      }
    } catch {
      settle(false);
    }
  });
}
