import { pathToFileURL } from "node:url";

/**
 * Node.js ESM Loader Hook for Windows absolute path resolution.
 * On Windows, absolute file paths begin with a drive letter (e.g., C:\...),
 * which Node's default ESM loader rejects with ERR_UNSUPPORTED_ESM_URL_SCHEME.
 * This hook automatically normalizes Windows drive-letter paths to file:// URLs.
 */
export async function resolve(specifier, context, nextResolve) {
  if (/^[a-zA-Z]:[\\/]/.test(specifier)) {
    return nextResolve(pathToFileURL(specifier).href, context);
  }
  return nextResolve(specifier, context);
}
