import type { PaperSimulationRunner } from "./paperSimulationRuns.js";

export interface LocalOperationsServerOptions {
  storageBaseDir: string;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  paperSimulationRunner?: PaperSimulationRunner;
}

export interface StartLocalOperationsServerOptions
  extends LocalOperationsServerOptions {
  host: string;
  port: number;
}
