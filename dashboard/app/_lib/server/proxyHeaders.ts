/**
 * Which headers the keyed proxy sends upstream, and where each one comes from.
 *
 * Extracted from app/api/pai/[...path]/route.ts so the policy is a pure
 * function with a test, instead of a header block inside a Next route handler
 * that nothing could exercise without a running server.
 *
 * THE RULE: the client contributes almost nothing. The returned object is built
 * from scratch on every call, so a header is upstream only because a line here
 * put it there. Everything that carries authority is either injected from
 * server-side state (the appliance API key) or derived from the pairing cookie
 * the route guard already verified (the device identity).
 *
 * WHAT THIS EXISTS TO PREVENT
 * ---------------------------
 * The backend keys its 300-second vault-unlocked chat session — the one that
 * answers protected questions ("what are my allergies") out of the DECRYPTED
 * vault with no further PIN — on a per-caller id. Taking that id from the
 * client's own `X-Client-Id` header (defaulting to the caller's LAN IP) would
 * let any caller able to reach the backend name a household member's value and
 * inherit their unlock. The backend ignores that header and honours only
 * `X-Puff-Device-Id` from a trusted (loopback) peer — which makes THIS file the
 * only thing that decides who a browser is. So: an allowlist. A relay default
 * would make every backend header a client-controlled input forever; an
 * allowlist makes each one a decision.
 *
 * A relayed header is also SCOPED to the paths where the backend actually reads
 * it. "Which headers cross" and "on which requests" are two separate decisions;
 * relaying a header everywhere because one subtree needs it hands a credential
 * to every other surface for free.
 *
 * puff puff pass
 */

/**
 * One relayed client header, and the request paths it is relayed ON.
 *
 * `path` is the already-decoded backend path segments (`["vault","contents"]`
 * for `/api/pai/vault/contents`), the same array the proxy allowlist and the
 * route's own checks ran against.
 */
export interface ForwardedClientHeader {
  /** Inbound header name, lowercase (header lookups are case-insensitive). */
  readonly header: string;
  /** Canonical name written upstream, so casing never depends on the client. */
  readonly upstream: string;
  /** True on the paths where the backend actually reads this header. */
  readonly scope: (path: readonly string[]) => boolean;
  /** Human reason, for the next person reading this list. */
  readonly why: string;
}

/**
 * Client headers relayed upstream verbatim. Add an entry only with a reason,
 * only for a header the dashboard's own code sends, and only with the narrowest
 * `scope` that keeps the feature working.
 *
 * Deliberately NOT here:
 *   x-client-id        the vault-session hijack above. Nothing reads it now;
 *                      relaying it would let a future reader become an
 *                      authorisation hole again.
 *   x-puff-device-id   asserted below from the cookie. A client copy must never
 *                      reach the backend, or the derivation is decorative.
 *   x-puff-anonymous   also asserted below, server-side, and the exact inverse:
 *                      it tells the backend "this proxied caller has NO verified
 *                      identity". A client able to set it could push a paired
 *                      device into the identity-less path; a client able to
 *                      CLEAR it is not a concern (the header is written here
 *                      from scratch), but relaying either direction would make
 *                      the marker the client's statement instead of ours.
 *   x-puff-display     a client-side presentation hint (kiosk vs. phone). It
 *                      may decide what a screen renders, never who the backend
 *                      thinks is asking, so it has no business upstream.
 *   x-api-key          the appliance credential. Injected server-side.
 *   x-zone3-ticket     a consent ticket the dashboard mints against the backend
 *                      directly; not sent through this proxy today, and a
 *                      consent artefact is exactly what should not ride in on a
 *                      relayed client header.
 *   x-forwarded-*      Next/runtime-injected; carry no meaning upstream and
 *   x-real-ip          would misinform the backend's per-IP limiter (and, since
 *                      the backend now keys chat sessions on the socket peer,
 *                      its session bucketing too if ProxyFix were ever
 *                      enabled).
 *   cookie             the puff_device pairing cookie is the credential this
 *                      whole gate rests on. It stops here.
 *
 * Content-Type and Accept are handled separately (they are not X-*, and they
 * are transport rather than application semantics).
 */
export const FORWARDED_CLIENT_HEADERS: readonly ForwardedClientHeader[] = [
  {
    header: "x-vault-token",
    upstream: "X-Vault-Token",
    // Scoped to the /vault subtree, which is EXACTLY the set of handlers that
    // read it: `grep -n "X-Vault-Token" src/puffpai/api_server.py` finds it in
    // /vault/setup-totp, /vault/lock, /vault/contents, /vault/store,
    // /vault/secrets/*, /vault/item/<key> (GET and DELETE), /vault/document,
    // /vault/resolve, /vault/recovery/generate and /vault/recovery/status, and
    // nowhere else (the one other hit is the CORS Access-Control-Allow-Headers
    // list). Relaying it on every path would hand a household member's unlock
    // session to /apps, /ha, /knowledge and anything added later, for nothing.
    // The whole subtree rather than a list of exact paths, because every
    // /vault/* endpoint that needs a session reads the same header and a
    // hardcoded list would silently 403 the next one added.
    scope: (path) => path[0] === "vault",
    why:
      "The caller's own vault UNLOCK SESSION, minted by the backend only after " +
      "a correct PIN and validated there by _vault_session_valid(). Relaying " +
      "it cannot bypass the PIN: a caller without a valid token still gets 403 " +
      '"Vault is locked". Without it the vault UI would be BROKEN, not merely ' +
      "locked down, the moment a /vault/* call moves behind this proxy — the " +
      "browser unlocks, then every following call arrives with no session " +
      "token and is refused.",
  },
];

/** The header the backend keys chat/vault sessions on. Server-set only. */
export const DEVICE_ID_HEADER = "X-Puff-Device-Id";

/**
 * Marker for "this request came through the proxy and has NO verified device
 * identity". Server-set only, and never relayed from a client.
 *
 * WHY A MARKER IS NEEDED AT ALL. Omitting DEVICE_ID_HEADER is ambiguous at the
 * backend: it is what a proxied request with no identity looks like, and ALSO
 * what a direct loopback caller (a script on the box, the CLI) looks like. The
 * backend resolved that ambiguity by keying both on the socket peer, i.e. on
 * `peer:127.0.0.1` — one shared vault-unlock bucket for every unidentified
 * proxied caller in the household. A legacy v1 cookie, an unpaired browser at
 * the "knowledge" enforcement stage, the device-token upload path and the kiosk
 * all landed in it together, so one member's 300-second unlock was inheritable
 * by any of the others for the rest of the window.
 *
 * With the marker the backend can be explicit instead: a trusted proxy peer that
 * says "anonymous" gets a single-use session key and no vault answers, while a
 * direct caller keeps its per-peer behaviour.
 *
 * NOT a display hint. A kiosk is anonymous or identified for exactly the same
 * reason as any other browser (whether its pairing cookie verifies) and never
 * because of where it is or what it renders.
 */
export const ANONYMOUS_HEADER = "X-Puff-Anonymous";

/**
 * Response headers relayed back to the browser. Everything else the backend
 * sends is dropped, as it always was.
 */
export const RELAYED_RESPONSE_HEADERS: readonly string[] = [
  "content-type",
  "cache-control",
  "content-disposition",
];

/**
 * Extra response headers for the offline-library ASSET endpoint only. It
 * serves third-party files (an HTML or SVG page can sit inside a ZIM) on the
 * dashboard's own origin, and for anything that could run it answers with
 * `Content-Disposition: attachment` plus a `sandbox` CSP. Dropping the CSP
 * here would leave the download as the only defence; relaying it everywhere
 * would let any backend route set policy on the dashboard origin.
 */
export const KNOWLEDGE_ASSET_RESPONSE_HEADERS: readonly string[] = [
  "content-disposition",
  "content-security-policy",
  "x-content-type-options",
];

/** `/knowledge/library/<id>/asset`, decoded segments, exact shape. */
export function isKnowledgeAssetPath(path: readonly string[]): boolean {
  return (
    path.length === 4 &&
    path[0] === "knowledge" &&
    path[1] === "library" &&
    !!path[2] &&
    path[3] === "asset"
  );
}

/**
 * The ONLY asset types served inline: images, audio, video, fonts and WebVTT
 * subtitles (a <track> needs text/vtt). CSS, PDF, HTML, SVG: attachment.
 * Key = the bare type (before any ";", trimmed, lower-cased); value = the
 * clean type sent to the browser. Must match _ZIM_INLINE_ASSET_TYPES in the
 * backend's api_server.py. Everything else is an octet-stream attachment.
 */
export const INLINE_ASSET_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
  "image/avif": "image/avif",
  "image/bmp": "image/bmp",
  "image/x-icon": "image/x-icon",
  "image/vnd.microsoft.icon": "image/x-icon",
  "video/mp4": "video/mp4",
  "video/webm": "video/webm",
  "video/ogg": "video/ogg",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/mp4": "audio/mp4",
  "audio/aac": "audio/aac",
  "audio/ogg": "audio/ogg",
  "audio/opus": "audio/opus",
  "audio/webm": "audio/webm",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/flac": "audio/flac",
  "audio/x-flac": "audio/flac",
  "font/woff": "font/woff",
  "font/woff2": "font/woff2",
  "font/ttf": "font/ttf",
  "font/otf": "font/otf",
  "text/vtt": "text/vtt",
  "application/font-woff": "font/woff",
  "application/x-font-woff": "font/woff",
  "application/font-woff2": "font/woff2",
  "application/x-font-ttf": "font/ttf",
  "application/x-font-otf": "font/otf",
});

export const KNOWLEDGE_ASSET_CSP = "default-src 'none'; sandbox";
const ASSET_FALLBACK_TYPE = "application/octet-stream";

/**
 * The Content-Type to send for an asset, and whether it may be inline.
 * Fails closed: a comma, quote or control character anywhere (Headers.get
 * also joins duplicate headers with ", "), or a bare type not on the list,
 * is an octet-stream attachment. Parameters are never forwarded.
 */
export function knowledgeAssetContentType(
  raw: string | null | undefined,
): { contentType: string; inline: boolean } {
  const value = typeof raw === "string" ? raw : "";
  if (!value || /[,"\u0000-\u001f\u007f]/.test(value)) {
    return { contentType: ASSET_FALLBACK_TYPE, inline: false };
  }
  const bare = value.split(";", 1)[0].trim().toLowerCase();
  const clean = Object.prototype.hasOwnProperty.call(INLINE_ASSET_TYPES, bare)
    ? INLINE_ASSET_TYPES[bare]
    : undefined;
  return clean
    ? { contentType: clean, inline: true }
    : { contentType: ASSET_FALLBACK_TYPE, inline: false };
}

/**
 * Set the asset headers on a response, whatever the backend sent: the clean
 * type, nosniff, the sandbox CSP, and an attachment for anything not inline.
 * Defence in depth behind the backend, which applies the same list.
 */
export function hardenKnowledgeAssetHeaders(
  headers: Headers,
  upstreamContentType: string | null | undefined,
): void {
  const { contentType, inline } = knowledgeAssetContentType(upstreamContentType);
  headers.set("Content-Type", contentType);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", KNOWLEDGE_ASSET_CSP);
  if (inline) headers.delete("Content-Disposition");
  else headers.set("Content-Disposition", "attachment");
}

/** Which upstream response headers the proxy copies back for this path. */
export function relayedResponseHeaders(path: readonly string[]): readonly string[] {
  if (!isKnowledgeAssetPath(path)) return RELAYED_RESPONSE_HEADERS;
  return Array.from(
    new Set([...RELAYED_RESPONSE_HEADERS, ...KNOWLEDGE_ASSET_RESPONSE_HEADERS]),
  );
}

/** Minimal shape read off a request. NextRequest satisfies it. */
export interface HeaderCarrier {
  headers: {
    get(name: string): string | null;
  };
}

/**
 * Build the upstream header set for a request that has ALREADY passed the
 * route's pairing gate and path allowlist.
 *
 * @param req            the incoming request; only headers are read, and only
 *                       the ones named here — an unlisted header is never even
 *                       looked at, let alone forwarded
 * @param apiKey         PUFFPAI_API_KEY, or "" to attach no Authorization.
 *                       Empty means the backend refuses the call, which is the
 *                       safe direction for a misconfigured box.
 * @param deviceSession  the identity, or null for "assert no identity" (which
 *                       is not silence: null makes this function write
 *                       ANONYMOUS_HEADER). The proxy route supplies
 *                       pairing.proxyDeviceSessionFor(req).sessionId, the same
 *                       derivation as deviceSessionIdFor plus the eager v1
 *                       upgrade. Passed in rather than derived here so this
 *                       function stays pure over its inputs and so the caller
 *                       cannot accidentally hand it something read off the
 *                       request: the only way to get a non-null value is to
 *                       verify a cookie.
 * @param path           decoded backend path segments, for the scoped relays.
 *
 * Authorization is written LAST so a client-sent Authorization can never win;
 * it is not relayable either, so it never gets that far.
 *
 * Content-Length is deliberately absent: the body is relayed as a stream, so
 * undici frames it chunked and a declared length would risk a mismatch. This
 * matches the pre-existing behaviour the calendar FormData upload relies on.
 */
export function upstreamHeaders(
  req: HeaderCarrier,
  apiKey: string,
  deviceSession: string | null,
  path: readonly string[] = [],
): Record<string, string> {
  const headers: Record<string, string> = {};

  const ct = req.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;
  const accept = req.headers.get("accept");
  if (accept) headers["Accept"] = accept;

  for (const rule of FORWARDED_CLIENT_HEADERS) {
    if (!rule.scope(path)) continue;
    const value = req.headers.get(rule.header);
    if (value) headers[rule.upstream] = value;
  }

  // WHO the backend should treat this as. Derived server-side from the verified
  // pairing cookie — an HMAC of the device id under the pairing secret, so it is
  // not the cookie (which must not land in a backend log) and not the raw device
  // id (which any paired caller can read from the paired-devices list).
  //
  // No identifying cookie -> the identity header is absent AND the anonymous
  // marker is present. Exactly one of the two is ever written, both server-side,
  // both after the relay loop so no client copy of either can survive.
  //
  // The marker is not a placeholder identity: the backend turns it into a key
  // unique to that one request, so unidentified callers are isolated from each
  // other as well as from paired devices. A constant placeholder here would have
  // reproduced the shared bucket it exists to remove.
  if (deviceSession) {
    headers[DEVICE_ID_HEADER] = deviceSession;
    delete headers[ANONYMOUS_HEADER];
  } else {
    delete headers[DEVICE_ID_HEADER];
    headers[ANONYMOUS_HEADER] = "1";
  }

  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  return headers;
}
