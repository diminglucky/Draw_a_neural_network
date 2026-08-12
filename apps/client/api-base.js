/**
 * The desktop/web client has one compiled-in foundation relay address.
 *
 * The browser must not read a mutable global for this value: a settings field
 * or a page script should not be able to redirect authenticated requests to an
 * arbitrary endpoint. Unit tests may inject a dependency explicitly, but the
 * application entry points call this function without an override.
 */
export const FIXED_FOUNDATION_API_URL = "http://127.0.0.1:4180";

export function resolveFoundationApiBase(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "apiBase")) {
    const value = typeof options.apiBase === "string" ? options.apiBase.trim() : "";
    if (!value) throw new Error("Foundation API base is invalid");
    return value.replace(/\/$/, "");
  }
  return FIXED_FOUNDATION_API_URL;
}
