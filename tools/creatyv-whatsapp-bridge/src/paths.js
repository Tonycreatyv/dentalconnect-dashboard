import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_ROOT = path.resolve(SOURCE_DIR, "..");
export const DATA_DIR = path.join(WORKER_ROOT, "data");
export const PROFILE_DIR = path.join(DATA_DIR, "whatsapp-profile");
export const DIAGNOSTICS_DIR = path.join(WORKER_ROOT, "diagnostics");

/** @param {string} root @param {string} candidate */
export function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateRuntimePaths() {
  if (!isPathInside(WORKER_ROOT, PROFILE_DIR) || !isPathInside(WORKER_ROOT, DIAGNOSTICS_DIR)) {
    throw new Error("Unsafe worker path configuration");
  }
  return { workerRoot: WORKER_ROOT, profileDir: PROFILE_DIR, diagnosticsDir: DIAGNOSTICS_DIR };
}
