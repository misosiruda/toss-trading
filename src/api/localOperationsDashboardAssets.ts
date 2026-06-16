import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { join } from "node:path";

import {
  LOCAL_OPERATIONS_DASHBOARD_ASSET_PATHS,
  LOCAL_OPERATIONS_DASHBOARD_DOCUMENT_PATHS
} from "./localOperationsSurface.js";

export interface DashboardAsset {
  fileName: string;
  contentType: string;
}

export function readDashboardAsset(pathname: string): DashboardAsset | null {
  if (
    (LOCAL_OPERATIONS_DASHBOARD_DOCUMENT_PATHS as readonly string[]).includes(
      pathname
    )
  ) {
    return {
      fileName: "index.html",
      contentType: "text/html; charset=utf-8"
    };
  }

  if (
    !(LOCAL_OPERATIONS_DASHBOARD_ASSET_PATHS as readonly string[]).includes(
      pathname
    )
  ) {
    return null;
  }

  const fileName = pathname.split("/").at(-1);
  if (fileName === undefined || fileName.length === 0) {
    return null;
  }

  if (pathname.endsWith(".js")) {
    return {
      fileName,
      contentType: "text/javascript; charset=utf-8"
    };
  }

  return {
    fileName: "styles.css",
    contentType: "text/css; charset=utf-8"
  };
}

export async function writeDashboardAsset(
  response: ServerResponse,
  asset: DashboardAsset,
  headOnly = false
): Promise<void> {
  const body = await readFile(join(process.cwd(), "dashboard", asset.fileName));
  response.writeHead(200, {
    "content-type": asset.contentType,
    "cache-control": "no-store"
  });
  response.end(headOnly ? undefined : body);
}
