/**
 * /api/media/status — health pre-flight for the embedded Jellyfin player.
 *
 * Server-side pings the loopback media-proxy (instrumentation.ts, localhost:8096
 * → Pi). The proxy silently destroys sockets when the Pi is unreachable, so a
 * browser-side fetch would hang; doing it here with a short AbortSignal timeout
 * lets us fail fast and drive the media-page error UI.
 *
 * /System/Info/Public is Jellyfin's unauthenticated liveness endpoint.
 *
 * puff puff pass
 */
import { NextResponse } from "next/server";

const JELLYFIN_URL =
  process.env.NEXT_PUBLIC_JELLYFIN_URL ?? "http://localhost:8096";

export async function GET() {
  try {
    const res = await fetch(`${JELLYFIN_URL}/System/Info/Public`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false });
    }

    const data = await res.json();
    return NextResponse.json({
      ok: true,
      serverName: data?.ServerName,
      version: data?.Version,
    });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
