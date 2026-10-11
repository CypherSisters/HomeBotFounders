/**
 * /api/pai/[...path] — generic server-side proxy to the PuffPAI backend.
 *
 * The API key must never ship in the client bundle (a NEXT_PUBLIC_ env var
 * is inlined into browser JavaScript). The browser calls this same-origin
 * route with NO key; the key lives server-side only (PUFFPAI_API_KEY in the
 * dashboard's environment) and is attached here. The dashboard therefore
 * works from any LAN device, not just the host (clients never need to reach
 * localhost:8000 themselves).
 *
 * Streaming (e.g. /chat/stream SSE) passes through untouched — the upstream
 * body is returned directly without buffering.
 *
 * puff puff pass
 */
import { NextRequest, NextResponse } from "next/server";
import { proxyDeviceSessionFor, requirePairing } from "@/app/_lib/server/pairing";
import { deviceTokenAllows } from "@/app/_lib/server/deviceToken";
import {
  isAllowedProxyPath,
  notAllowedResponse,
} from "@/app/_lib/server/proxyAllowlist";
import {
  hardenKnowledgeAssetHeaders,
  isKnowledgeAssetPath,
  relayedResponseHeaders,
  upstreamHeaders,
} from "@/app/_lib/server/proxyHeaders";

// Both spellings accepted: PUFFPAI_BACKEND_URL (laptop .env.local) and
// PUFFPAI_API_URL (Orin /etc/puffpai/dashboard.env) name the same backend.
const BACKEND =
  process.env.PUFFPAI_BACKEND_URL ??
  process.env.PUFFPAI_API_URL ??
  "http://localhost:8000";
// Server-side only, and deliberately the ONLY spelling accepted. There is no
// NEXT_PUBLIC_ fallback: Next inlines those into the client bundle, so one
// would quietly ship the key to every browser the moment someone set it. Empty means no Authorization is attached
// and the backend refuses the call — the safe direction.
const API_KEY = process.env.PUFFPAI_API_KEY ?? "";

/**
 * Hard ceiling on a forwarded request body. "Send to Puff" uploads photos and
 * documents; 50 MB covers those with room to spare while stopping a LAN client
 * from using the appliance's own credential to shove an arbitrary amount of
 * data at the backend.
 *
 * Only Content-Length can be checked cheaply here — a chunked body with no
 * declared length streams straight through, so the backend's own body limit is
 * the defence-in-depth backstop for that case.
 */
const MAX_BODY_BYTES = 50 * 1024 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Second layer behind middleware.ts — if a matcher is ever mis-edited, this
  // route still refuses unpaired LAN clients rather than lending them the key.
  //
  // deviceTokenAllows() is the ONLY exception: a valid, unexpired, upload-scoped
  // device token (the iPhone Shortcut, which carries no cookie) satisfies the
  // gate for POST /api/pai/knowledge/upload and NOTHING else. verifyDeviceToken
  // re-checks scope against this request's own method+path, so the token can
  // never reach an HA/camera/knowledge-read route even from here.
  const denied = requirePairing(req);
  if (denied && !deviceTokenAllows(req)) return denied;

  const { path } = await params;

  // Defence in depth against the encoded-separator split-brain: Next decodes
  // each catch-all segment, so an encoded slash/backslash (%2f, %2F, %5c, %5C)
  // in the incoming path arrives here as a segment that literally CONTAINS a
  // "/" or "\". No real backend path is ever addressed that way — the only
  // reason to encode a separator is to make the reconstructed upstream path
  // differ from the path the pairing gate inspected. Reject outright so the
  // proxy can never act on a path shape the gate didn't see.
  if (path.some((seg) => seg.includes("/") || seg.includes("\\"))) {
    return Response.json(
      { error: "encoded path separator not allowed" },
      { status: 400 },
    );
  }

  // Pairing decided WHO may use the proxy; this decides WHAT they may reach
  // with the appliance's key. Without it, one paired device (or any script on
  // the dashboard's own origin) reaches every endpoint the backend has, not
  // just the ones the UI actually calls. 404, not 403, so a prober cannot map
  // the backend by watching which paths answer differently.
  if (!isAllowedProxyPath(path)) return notAllowedResponse();

  const declared = req.headers.get("content-length");
  if (declared) {
    const len = Number(declared);
    if (!Number.isFinite(len) || len < 0) {
      return Response.json({ error: "invalid content-length" }, { status: 400 });
    }
    if (len > MAX_BODY_BYTES) {
      return Response.json(
        { error: "payload too large", maxBytes: MAX_BODY_BYTES },
        { status: 413 },
      );
    }
  }

  const url = `${BACKEND}/${path.join("/")}${req.nextUrl.search}`;

  // Allow-list of forwarded headers: nothing else crosses to the backend. See
  // app/_lib/server/proxyHeaders.ts for what is relayed, on which paths, and
  // why. In particular the puff_device pairing cookie (and every other cookie)
  // is NOT forwarded: the backend has no use for it and it must not leak past
  // the dashboard's trust boundary. X-Vault-Token is the one relayed client
  // header, and it is scoped to the /vault subtree by the rule table.
  //
  // proxyDeviceSessionFor() re-verifies the pairing cookie (HMAC + device
  // registry) and returns an HMAC-derived, stable, non-guessable id for this
  // device: the value the backend keys its 300-second vault-unlocked chat
  // session on, and which it believes only from a trusted (loopback) peer. A
  // client-supplied copy of that header is never consulted: upstreamHeaders
  // builds its result from scratch, reads only the headers its own rule table
  // names, and writes this one itself. When it returns null, upstreamHeaders
  // sends X-Puff-Anonymous instead and the backend gives the request a
  // single-use session key with no vault access, so an unidentified caller
  // gets nothing rather than sharing a bucket with other unidentified callers.
  //
  // It also UPGRADES a legacy v1 cookie on this very request (setCookie below),
  // rather than leaving the first proxied call identity-less while the
  // replacement cookie rides back on the response.
  //
  // Content-Length is deliberately NOT forwarded: the body is relayed as a
  // stream, so undici frames it chunked. Declaring a length here would risk a
  // length/body mismatch. This matches the pre-existing behaviour that the
  // calendar FormData upload already relies on.
  const session = proxyDeviceSessionFor(req);
  const headers = upstreamHeaders(
    req,
    API_KEY,
    session.sessionId,
    path,
  );

  // Bodies stream through untouched (duplex: "half"), so multipart/form-data
  // uploads are never buffered into memory here — a 5-10 MB photo is relayed
  // chunk by chunk with its original boundary and Content-Type intact.
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    cache: "no-store",
    body: hasBody ? req.body : undefined,
    duplex: hasBody ? "half" : undefined, // required for streamed request bodies
  };

  try {
    const upstream = await fetch(url, init);
    const respHeaders = new Headers();
    // Scoped: the asset endpoint's sandbox CSP comes back too, nothing else
    // gains a header (see relayedResponseHeaders).
    for (const h of relayedResponseHeaders(path)) {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    }
    // Pack files: re-apply the asset allowlist here too, whatever came back.
    if (isKnowledgeAssetPath(path)) {
      hardenKnowledgeAssetHeaders(respHeaders, upstream.headers.get("content-type"));
    }
    const res = new NextResponse(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
    // The v1 → v2 upgrade (or a due sliding renewal) decided above. Attached
    // here so the browser is holding the identifying cookie from now on; the
    // request it rode in on was already served under the identity derived from
    // it, so there is no window where the two disagree.
    if (session.setCookie) res.cookies.set(session.setCookie);
    return res;
  } catch {
    return Response.json(
      { error: "PuffPAI backend unreachable" },
      { status: 502 },
    );
  }
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
};
