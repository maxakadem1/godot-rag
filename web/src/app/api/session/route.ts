/**
 * GET: is this visitor unlocked? POST {password}: unlock. DELETE: lock again.
 * See lib/server/session.ts for how the cookie is signed.
 */
import { cookies } from "next/headers";
import { clientIp } from "@/lib/server/ip";
import { checkLimit } from "@/lib/server/limits";
import {
  createToken,
  isConfigured,
  passwordMatches,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifyToken,
} from "@/lib/server/session";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return Response.json({ unlocked: verifyToken(token), configured: isConfigured() });
}

export async function POST(req: Request) {
  if (!isConfigured())
    return Response.json({ detail: "Unlocking isn't set up on this server" }, { status: 503 });

  const limit = await checkLimit("unlock", clientIp(req));
  if (!limit.ok)
    return Response.json(
      { detail: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterS! / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterS) } },
    );

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !passwordMatches(password))
    return Response.json({ detail: "Wrong password" }, { status: 401 });

  (await cookies()).set(SESSION_COOKIE, createToken()!, {
    httpOnly: true, // page scripts can't read it, so injected JS can't steal it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return Response.json({ unlocked: true });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ unlocked: false });
}
