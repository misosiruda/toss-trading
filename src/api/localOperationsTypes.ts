export interface LocalOperationsServerOptions {
  storageBaseDir: string;
  now?: () => Date;
}

export interface StartLocalOperationsServerOptions
  extends LocalOperationsServerOptions {
  host: string;
  port: number;
}
