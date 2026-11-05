import "server-only";

/**
 * The visitor's IP. On Vercel the platform sets x-forwarded-for itself, so its first
 * entry is the real client; a client can't spoof it there. Locally it's usually absent.
 */
export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
