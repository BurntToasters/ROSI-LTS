import * as path from "path";
import { fileURLToPath } from "url";

export function isSafeHttpUrl(value: unknown) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(value: unknown) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "ms-windows-store:"
    );
  } catch {
    return false;
  }
}

export function isAllowedNavigationUrl(
  value: unknown,
  allowedFileBase?: string,
) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return false;
    if (!allowedFileBase) return true;
    const base = path.resolve(allowedFileBase);
    const relative = path.relative(base, path.resolve(fileURLToPath(url)));
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  } catch {
    return false;
  }
}
