/**
 * What the keyed proxy at app/api/pai/[...path] tells the backend about the
 * caller. Plain Node — upstreamHeaders() is a pure function over headers and
 * path segments, so there is nothing to mock and no server to start.
 *
 *   npm run test:proxyheaders
 *   node app/_lib/server/__tests__/proxy-headers.test.mjs
 *
 * Requires Node >=22.6 for native TypeScript type stripping. Exits non-zero on
 * any failure.
 *
 * WHY THIS FILE EXISTS: the backend keys its 300-second vault-unlocked chat
 * session — protected questions answered out of the DECRYPTED vault with no
 * further PIN — on a per-caller id. Taking that id from the client's own
 * `X-Client-Id` header (default: the caller's LAN IP) would let a caller
 * name a household member's value and inherit their unlock. The backend
 * ignores that header and believes `X-Puff-Device-Id` only from a loopback
 * peer, which makes this module the only thing that decides who a browser is.
 * Four properties are asserted:
 *
 *   1. client headers are an allowlist, not a denylist: X-Client-Id,
 *      X-Puff-Device-Id, X-Api-Key, X-Puff-Display, cookies and Authorization
 *      never reach the backend;
 *   2. the one relayed header (X-Vault-Token) is relayed ONLY on /vault/*,
 *      the only subtree whose handlers read it;
 *   3. the device identity is derived from the VERIFIED pairing cookie — not the
 *      raw device id, not the cookie, and absent entirely when there is no
 *      identifying cookie;
 *   4. the real route is wired this way (asserted against its source), since a
 *      pure helper is only as good as its one caller;
 *   5. "no identity" is SAID rather than implied: a request the proxy cannot
 *      identify carries X-Puff-Anonymous instead of nothing, so the backend can
 *      give it a single-use session key instead of the loopback bucket every
 *      other unidentified caller shares — and a legacy v1 cookie is upgraded on
 *      the request itself, so the first proxied chat call is already identified;
 *   6. no server-side module makes an access decision from a display hint
 *      (puffMode / X-Puff-Display / isApplianceDisplay): those are client-
 *      controlled presentation, and this repo has no such function at all.
 *
 * SAFETY: PUFF_PAIRING_STATE / PUFF_PAIRED_DEVICES are pointed at a fresh temp
 * directory BEFORE pairing.ts is imported, so no real household state is read
 * or written and no real secret is involved.
 *
 * Lives under app/_lib/ (underscore-private), so Next never routes it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = path.resolve(HERE, "..", "..", "..", "..");

/* ── sandbox ───────────────────────────────────────────────────────── */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "puff-proxyhdr-"));
process.env.PUFF_PAIRING_STATE = path.join(DIR, "pairing.json");
process.env.PUFF_PAIRED_DEVICES = path.join(DIR, "devices.json");

const {
  upstreamHeaders,
  FORWARDED_CLIENT_HEADERS,
  DEVICE_ID_HEADER,
  ANONYMOUS_HEADER,
} = await import("../proxyHeaders.ts");
const {
  RELAYED_RESPONSE_HEADERS,
  KNOWLEDGE_ASSET_RESPONSE_HEADERS,
  KNOWLEDGE_ASSET_CSP,
  INLINE_ASSET_TYPES,
  isKnowledgeAssetPath,
  relayedResponseHeaders,
  knowledgeAssetContentType,
  hardenKnowledgeAssetHeaders,
} = await import("../proxyHeaders.ts");
const P = await import("../pairing.ts");

/* ── harness ───────────────────────────────────────────────────────── */

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok_ = Object.is(got, want);
  if (ok_) pass++;
  else fail++;
  console.log(`${ok_ ? "PASS" : "FAIL"}  ${label}  -> ${got} (want ${want})`);
}
function ok(label, cond) {
  check(label, !!cond, true);
}
function section(name) {
  console.log(`\n--- ${name} ---`);
}

/**
 * Exactly what app/api/pai/[...path]/route.ts does: verify the cookie, then
 * build the header set from the verified result plus the decoded path. Asserted
 * below against the route source so this helper cannot drift away from the real
 * call.
 */
const buildHeaders = (req, segs = [], key = "K") =>
  upstreamHeaders(req, key, P.deviceSessionIdFor(req), segs);

/**
 * What the REAL route does now: proxyDeviceSessionFor(), which additionally
 * upgrades a legacy v1 cookie in place so the first proxied call already carries
 * an identity. Asserted against the route source in section 5.
 */
const buildRouteHeaders = (req, segs = [], key = "K") =>
  upstreamHeaders(req, key, P.proxyDeviceSessionFor(req).sessionId, segs);

/** A request carrying the given headers and (optionally) a device cookie. */
function reqWith(headerObj, cookieValue) {
  return {
    headers: new Headers(headerObj),
    cookies: {
      get: (name) =>
        name === P.PAIRING_COOKIE && cookieValue
          ? { value: cookieValue }
          : undefined,
    },
  };
}
/** Case-insensitive lookup over the returned plain object. */
function hdr(out, name) {
  const want = name.toLowerCase();
  for (const k of Object.keys(out)) if (k.toLowerCase() === want) return out[k];
  return undefined;
}

const device = P.addPairedDevice("Kitchen tablet");
const goodCookie = P.issueDeviceCookieValueV2(device.id);
const otherDevice = P.addPairedDevice("Someone else's phone");
const expectedSession = P.deviceSessionId(device.id);

/* ── 1. client headers: allowlist, not denylist ─────────────────────── */

section("client headers: allowlist, not denylist");
check("the allowlist is exactly one header", FORWARDED_CLIENT_HEADERS.length, 1);
check(
  "...and it is x-vault-token",
  FORWARDED_CLIENT_HEADERS[0].header,
  "x-vault-token",
);
ok(
  "...with a stated reason",
  typeof FORWARDED_CLIENT_HEADERS[0].why === "string" &&
    FORWARDED_CLIENT_HEADERS[0].why.length > 20,
);

{
  // The hijack itself: a paired device naming another member's vault session.
  const out = buildHeaders(
    reqWith(
      {
        "X-Client-Id": "192.168.1.42",
        "X-Vault-Token": "vault-session-abc",
        "X-Anything-Else": "nope",
        "X-Api-Key": "attacker-supplied",
        "X-Zone3-Ticket": "attacker-consent",
        "X-Puff-Display": "kiosk",
        "X-Forwarded-For": "10.0.0.9",
        "X-Real-Ip": "10.0.0.9",
        Authorization: "Bearer attacker-supplied",
        Cookie: "puff_device=should-not-be-relayed",
      },
      goodCookie,
    ),
    ["vault", "contents"],
    "REAL-KEY",
  );
  check(
    "X-Client-Id is DROPPED (the vault-session hijack)",
    hdr(out, "x-client-id"),
    undefined,
  );
  check(
    "an arbitrary X-* header is DROPPED",
    hdr(out, "x-anything-else"),
    undefined,
  );
  check("a client X-Api-Key is DROPPED", hdr(out, "x-api-key"), undefined);
  check(
    "a client X-Zone3-Ticket is DROPPED",
    hdr(out, "x-zone3-ticket"),
    undefined,
  );
  check(
    "a client X-Puff-Display is DROPPED (a display hint, never upstream)",
    hdr(out, "x-puff-display"),
    undefined,
  );
  check("X-Forwarded-For is DROPPED", hdr(out, "x-forwarded-for"), undefined);
  check("X-Real-Ip is DROPPED", hdr(out, "x-real-ip"), undefined);
  check(
    "the pairing cookie never crosses to the backend",
    hdr(out, "cookie"),
    undefined,
  );
  check(
    "X-Vault-Token PASSES on /vault/* (the unlock session)",
    hdr(out, "x-vault-token"),
    "vault-session-abc",
  );
  check(
    "Authorization is the appliance key, not the client's",
    hdr(out, "authorization"),
    "Bearer REAL-KEY",
  );
}

/* ── 2. the vault token is SCOPED to /vault/* ───────────────────────── */

section("the vault token is scoped to /vault/*");
for (const segs of [
  ["vault", "contents"],
  ["vault", "item", "passport"],
  ["vault", "store"],
  ["vault", "document"],
  ["vault", "resolve"],
  ["vault", "setup-totp"],
  ["vault", "lock"],
  ["vault", "secrets", "ha_admin_token"],
  ["vault", "recovery", "generate"],
  ["vault", "recovery", "status"],
]) {
  const out = buildHeaders(
    reqWith({ "X-Vault-Token": "tok" }, goodCookie),
    segs,
  );
  check(
    `relayed on /${segs.join("/")}`,
    hdr(out, "x-vault-token"),
    "tok",
  );
}
for (const segs of [
  ["apps", "fitfam", "data"],
  ["chat", "send"],
  ["ha", "entities"],
  ["knowledge", "upload"],
  ["setup", "status"],
  ["system", "status"],
  ["vaultish"],
  [],
]) {
  const out = buildHeaders(
    reqWith({ "X-Vault-Token": "tok" }, goodCookie),
    segs,
  );
  check(
    `NOT relayed on /${segs.join("/") || "(root)"}`,
    hdr(out, "x-vault-token"),
    undefined,
  );
}

/* ── 3. the device identity comes from the cookie, never the caller ── */

section("the device identity comes from the cookie, never the caller");
{
  const out = buildHeaders(reqWith({}, goodCookie), ["chat", "send"]);
  check(
    "a verified cookie yields the header",
    hdr(out, DEVICE_ID_HEADER),
    expectedSession,
  );
  ok(
    "...which is NOT the raw device id",
    hdr(out, DEVICE_ID_HEADER) !== device.id,
  );
  ok(
    "...and is NOT the cookie",
    !String(hdr(out, DEVICE_ID_HEADER)).includes(goodCookie),
  );
  ok(
    "...and is 32 hex chars",
    /^[0-9a-f]{32}$/.test(hdr(out, DEVICE_ID_HEADER)),
  );
  ok(
    "...and fits the backend's ^[A-Za-z0-9_-]{8,64}$ shape check",
    /^[A-Za-z0-9_-]{8,64}$/.test(hdr(out, DEVICE_ID_HEADER)),
  );
}
{
  // A client that supplies the header itself gets it thrown away and replaced.
  const out = buildHeaders(
    reqWith(
      { [DEVICE_ID_HEADER]: P.deviceSessionId(otherDevice.id) },
      goodCookie,
    ),
    ["chat", "send"],
  );
  check(
    "a client-supplied device id is overwritten with its own",
    hdr(out, DEVICE_ID_HEADER),
    expectedSession,
  );
}
{
  // No cookie -> assert nothing at all, rather than a placeholder that would be
  // a session shared between every unidentified caller.
  const out = buildHeaders(
    reqWith({ [DEVICE_ID_HEADER]: "forged-value-0001" }),
    ["chat", "send"],
  );
  check("no cookie -> no device header", hdr(out, DEVICE_ID_HEADER), undefined);
}
{
  const bad = goodCookie.slice(0, -1) + (goodCookie.endsWith("a") ? "b" : "a");
  const out = buildHeaders(reqWith({}, bad), ["chat", "send"]);
  check(
    "a cookie with a bad MAC -> no device header",
    hdr(out, DEVICE_ID_HEADER),
    undefined,
  );
}
{
  const revoked = P.addPairedDevice("Sold on eBay");
  const cookie = P.issueDeviceCookieValueV2(revoked.id);
  P.revokePairedDevice(revoked.id);
  const out = buildHeaders(reqWith({}, cookie), ["chat", "send"]);
  check(
    "a revoked device -> no device header",
    hdr(out, DEVICE_ID_HEADER),
    undefined,
  );
}
{
  // A legacy v1 cookie proves membership but names no device, so the raw
  // derivation asserts nothing: the alternative is every v1 device sharing one
  // unlock bucket.
  const out = buildHeaders(reqWith({}, P.issueDeviceCookieValue()), [
    "chat",
    "send",
  ]);
  check(
    "a legacy v1 cookie -> no device header from deviceSessionIdFor",
    hdr(out, DEVICE_ID_HEADER),
    undefined,
  );
}
check(
  "two devices derive different session ids",
  P.deviceSessionId(device.id) === P.deviceSessionId(otherDevice.id),
  false,
);
check(
  "the derivation is stable across calls",
  P.deviceSessionId(device.id),
  expectedSession,
);
{
  let threw = false;
  try {
    P.deviceSessionId("not a device id");
  } catch {
    threw = true;
  }
  ok("a malformed device id is refused, not signed", threw);
}

/* ── 3b. the anonymous marker: no identity is SAID, not implied ─────── */

section("the anonymous marker");
{
  // The bug: omitting the identity header made a proxied request with no
  // identity indistinguishable from a direct loopback caller, so the backend
  // keyed them all on peer:127.0.0.1 — ONE shared vault-unlock bucket.
  const out = buildHeaders(reqWith({}), ["chat", "send"]);
  check("no cookie -> the marker is SET", hdr(out, ANONYMOUS_HEADER), "1");
  check(
    "...and no identity header rides with it",
    hdr(out, DEVICE_ID_HEADER),
    undefined,
  );
}
{
  const out = buildHeaders(reqWith({}, goodCookie), ["chat", "send"]);
  check(
    "a paired v2 device -> no marker",
    hdr(out, ANONYMOUS_HEADER),
    undefined,
  );
  check(
    "...just its own identity",
    hdr(out, DEVICE_ID_HEADER),
    expectedSession,
  );
}
{
  // The marker must be OURS. A client that sets it could otherwise push a paired
  // browser onto the identity-less path; a client that clears it must not be able
  // to make an unidentified request look identified either.
  const out = buildHeaders(
    reqWith({ [ANONYMOUS_HEADER]: "0", "X-Puff-Anonymous": "0" }),
    ["chat", "send"],
  );
  check(
    "a client-supplied marker is REPLACED with ours",
    hdr(out, ANONYMOUS_HEADER),
    "1",
  );
}
{
  const out = buildHeaders(reqWith({ [ANONYMOUS_HEADER]: "1" }, goodCookie), [
    "chat",
    "send",
  ]);
  check(
    "a client-supplied marker on a PAIRED request is dropped",
    hdr(out, ANONYMOUS_HEADER),
    undefined,
  );
}
ok(
  "the marker is not in the relay allowlist",
  !FORWARDED_CLIENT_HEADERS.some(
    (r) => r.header.toLowerCase() === ANONYMOUS_HEADER.toLowerCase(),
  ),
);
{
  const out = buildHeaders(reqWith({}, P.issueDeviceCookieValue()), [
    "chat",
    "send",
  ]);
  check(
    "a legacy v1 cookie is not silently 'identified'",
    hdr(out, DEVICE_ID_HEADER),
    undefined,
  );
  check("...it is marked anonymous", hdr(out, ANONYMOUS_HEADER), "1");
}

/* ── 3c. the v1 cookie is upgraded ON the proxied request ───────────── */

section("v1 is upgraded on the request, not the one after it");
{
  const v1 = P.issueDeviceCookieValue();
  const req = reqWith({}, v1);
  const decided = P.proxyDeviceSessionFor(req);
  ok("a verified v1 cookie yields an identity", !!decided.sessionId);
  ok("...and a replacement cookie", !!decided.setCookie);
  ok(
    "...which is a v2 cookie for the pairing cookie name",
    decided.setCookie?.name === P.PAIRING_COOKIE &&
      String(decided.setCookie?.value).startsWith("v2."),
  );
  const out = buildRouteHeaders(req, ["chat", "send"]);
  check(
    "the route therefore sends an identity on the FIRST v1 call",
    hdr(out, DEVICE_ID_HEADER),
    decided.sessionId,
  );
  check("...and no marker", hdr(out, ANONYMOUS_HEADER), undefined);

  // The following request, carrying the upgraded cookie, is the same device.
  const after = P.proxyDeviceSessionFor(reqWith({}, decided.setCookie.value));
  check(
    "the upgraded cookie derives the SAME identity next request",
    after.sessionId,
    decided.sessionId,
  );
  check(
    "...and a fresh v2 cookie is not re-issued every request",
    after.setCookie,
    null,
  );

  // Two different v1 cookies are two different devices, not one shared bucket.
  const otherV1 = P.issueDeviceCookieValue(Date.now() + 1000);
  const otherDecided = P.proxyDeviceSessionFor(reqWith({}, otherV1));
  ok(
    "two distinct v1 cookies upgrade to two distinct identities",
    !!otherDecided.sessionId && otherDecided.sessionId !== decided.sessionId,
  );
  // And the same v1 cookie seen twice does NOT mint a second registry row.
  const again = P.proxyDeviceSessionFor(reqWith({}, v1));
  check(
    "the same v1 cookie is deduped to one device",
    again.sessionId,
    decided.sessionId,
  );
}
{
  // Middleware's lazy path and the proxy's eager path must agree about which
  // device a v1 cookie became, or a page load and an API call in the same tick
  // would mint two rows.
  const v1 = P.issueDeviceCookieValue(Date.now() + 2000);
  const req = reqWith({}, v1);
  const viaProxy = P.proxyDeviceSessionFor(req);
  const viaMiddleware = P.renewalCookieFor(req);
  ok(
    "renewalCookieFor and proxyDeviceSessionFor share the upgrade map",
    !!viaMiddleware &&
      P.proxyDeviceSessionFor(reqWith({}, viaMiddleware.value)).sessionId ===
        viaProxy.sessionId,
  );
}
{
  const out = buildRouteHeaders(reqWith({}), ["chat", "send"]);
  check(
    "no cookie at all -> still anonymous through the route helper",
    hdr(out, ANONYMOUS_HEADER),
    "1",
  );
}
{
  // The marker is about identity, not about what a path may reach: an
  // unidentified caller on /vault/* still relays its own vault token, and is
  // still refused by the backend if that token is not a valid session.
  const out = buildHeaders(reqWith({ "X-Vault-Token": "tok" }), [
    "vault",
    "contents",
  ]);
  check("the marker rides on /vault/* too", hdr(out, ANONYMOUS_HEADER), "1");
  check(
    "...and does not suppress the scoped relay",
    hdr(out, "x-vault-token"),
    "tok",
  );
}

/* ── 4. transport headers and the empty-key case ────────────────────── */

section("transport headers and the empty-key case");
{
  const out = buildHeaders(
    reqWith(
      { "Content-Type": "application/json", Accept: "text/event-stream" },
      goodCookie,
    ),
    ["chat", "stream"],
    "",
  );
  check("Content-Type is relayed", hdr(out, "content-type"), "application/json");
  check("Accept is relayed", hdr(out, "accept"), "text/event-stream");
  check(
    "an empty API key attaches NO Authorization",
    hdr(out, "authorization"),
    undefined,
  );
  check(
    "Content-Length is never declared (the body is streamed)",
    hdr(out, "content-length"),
    undefined,
  );
}

/* ── 5. the route really is wired this way ──────────────────────────── */

section("the route really is wired this way");
{
  const routeSrc = fs.readFileSync(
    path.join(DASHBOARD, "app", "api", "pai", "[...path]", "route.ts"),
    "utf8",
  );
  ok(
    "the route builds headers with upstreamHeaders(req, API_KEY, ...)",
    /upstreamHeaders\(\s*req\s*,\s*API_KEY\s*,/.test(routeSrc),
  );
  ok(
    "...deriving the identity from the cookie, not from a header",
    /const\s+session\s*=\s*proxyDeviceSessionFor\(req\)/.test(routeSrc),
  );
  ok(
    "...passing session.sessionId, not anything read off the request",
    /upstreamHeaders\(\s*req\s*,\s*API_KEY\s*,\s*session\.sessionId\s*,/.test(
      routeSrc,
    ),
  );
  ok(
    "...and the decoded path, so the relays stay scoped",
    /upstreamHeaders\(\s*req\s*,\s*API_KEY\s*,\s*session\.sessionId\s*,\s*path\s*,?\s*\)/.test(
      routeSrc,
    ),
  );
  ok(
    "...and attaching the upgrade/renewal cookie it decided on",
    /if\s*\(session\.setCookie\)\s*res\.cookies\.set\(session\.setCookie\)/.test(
      routeSrc,
    ),
  );
  ok(
    "the route never reads the device id header off the request",
    !new RegExp(`get\\(\\s*["'\`]${DEVICE_ID_HEADER}`, "i").test(routeSrc),
  );
  ok(
    "the route never reads the anonymous marker off the request",
    !new RegExp(`get\\(\\s*["'\`]${ANONYMOUS_HEADER}`, "i").test(routeSrc),
  );
  ok(
    "the route relays no header by prefix",
    !/startsWith\(\s*["']x-/i.test(routeSrc),
  );
  ok("the route never mentions X-Client-Id", !/x-client-id/i.test(routeSrc));
  ok(
    "the route copies response headers only via relayedResponseHeaders(path)",
    /for\s*\(\s*const\s+h\s+of\s+relayedResponseHeaders\(\s*path\s*\)\s*\)/.test(routeSrc) &&
      !/for\s*\(\s*const\s+h\s+of\s+\[\s*["']content-type["']/.test(routeSrc),
  );
}

/* ── 5b. response headers: the asset sandbox comes back, nothing else ─── */

section("response headers relayed back to the browser");
{
  const base = [...RELAYED_RESPONSE_HEADERS].sort();
  check(
    "ordinary paths relay exactly content-type, cache-control, content-disposition",
    JSON.stringify(base),
    JSON.stringify(["cache-control", "content-disposition", "content-type"]),
  );
  for (const segs of [
    ["chat", "send"],
    ["vault", "contents"],
    ["knowledge", "library", "wiki", "article"],
    ["knowledge", "library", "wiki", "main"],
    ["knowledge", "library", "asset"],
    ["knowledge", "library", "wiki", "asset", "x"],
    ["knowledge", "asset"],
    ["apps", "library", "wiki", "asset"],
    [],
  ]) {
    const got = relayedResponseHeaders(segs);
    ok(
      `/${segs.join("/")} gains no CSP`,
      !got.includes("content-security-policy") && !isKnowledgeAssetPath(segs),
    );
    check(`/${segs.join("/")} relays only the base set`, got.length, base.length);
  }
  const asset = relayedResponseHeaders(["knowledge", "library", "wiki", "asset"]);
  ok("the asset endpoint relays its sandbox CSP", asset.includes("content-security-policy"));
  ok("...and Content-Disposition", asset.includes("content-disposition"));
  ok("...and nosniff", asset.includes("x-content-type-options"));
  ok("...and still the base set", base.every((h) => asset.includes(h)));
  check("...with no duplicates", new Set(asset).size, asset.length);
  ok(
    "no relayed response header can set cookies or redirect",
    ![...asset, ...base].some((h) => /set-cookie|location|refresh/i.test(h)),
  );

  const assetRoute = fs.readFileSync(
    path.join(DASHBOARD, "app", "api", "knowledge", "asset", "route.ts"),
    "utf8",
  );
  ok(
    "KNOWLEDGE_ASSET_RESPONSE_HEADERS names the sandbox CSP and the download",
    KNOWLEDGE_ASSET_RESPONSE_HEADERS.includes("content-security-policy") &&
      KNOWLEDGE_ASSET_RESPONSE_HEADERS.includes("content-disposition"),
  );
}

/* ── 6. display mode is presentation, never authentication ──────────── */

section("display mode is never an access decision");
{
  // There is no isApplianceDisplay() in this repo (checked below, so the day
  // someone adds one this test is already waiting for it). What DOES exist is
  // the client-side kiosk hint: ?puffMode=kiosk, persisted in localStorage and
  // read only by the pre-hydration script in app/layout.tsx to toggle CSS
  // classes. All three of its inputs — the query string, localStorage, and a
  // Host/X-Puff-Display header if one were ever added — are client-controlled,
  // so nothing that grants access may consult them. Asserted over every
  // server-side module: middleware, the API routes, and app/_lib/server.
  const roots = [
    path.join(DASHBOARD, "middleware.ts"),
    path.join(DASHBOARD, "app", "api"),
    path.join(DASHBOARD, "app", "_lib", "server"),
  ];
  const files = [];
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) {
        if (e === "__tests__" || e === "node_modules") continue;
        walk(path.join(p, e));
      }
      return;
    }
    if (/\.(ts|tsx|mjs|js)$/.test(p)) files.push(p);
  };
  roots.forEach(walk);
  ok("found server-side modules to check", files.length > 5);
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    // Comments are allowed to discuss it; code is not.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    if (/isApplianceDisplay|x-puff-display|puffMode/i.test(code)) {
      offenders.push(path.relative(DASHBOARD, f));
    }
  }
  ok(
    `no server-side module reads a display hint (${offenders.join(", ") || "none"})`,
    offenders.length === 0,
  );
}

/* ── 5b. response headers: the asset sandbox comes back, nothing else ─── */

section("response headers relayed back to the browser");
{
  const base = [...RELAYED_RESPONSE_HEADERS].sort();
  check(
    "ordinary paths relay exactly content-type, cache-control, content-disposition",
    JSON.stringify(base),
    JSON.stringify(["cache-control", "content-disposition", "content-type"]),
  );
  for (const segs of [
    ["chat", "send"],
    ["vault", "contents"],
    ["knowledge", "library", "wiki", "article"],
    ["knowledge", "library", "wiki", "main"],
    ["knowledge", "library", "asset"],
    ["knowledge", "library", "wiki", "asset", "x"],
    ["knowledge", "asset"],
    ["apps", "library", "wiki", "asset"],
    [],
  ]) {
    const got = relayedResponseHeaders(segs);
    ok(
      `/${segs.join("/")} gains no CSP`,
      !got.includes("content-security-policy") && !isKnowledgeAssetPath(segs),
    );
    check(`/${segs.join("/")} relays only the base set`, got.length, base.length);
  }
  const asset = relayedResponseHeaders(["knowledge", "library", "wiki", "asset"]);
  ok("the asset endpoint relays its sandbox CSP", asset.includes("content-security-policy"));
  ok("...and Content-Disposition", asset.includes("content-disposition"));
  ok("...and nosniff", asset.includes("x-content-type-options"));
  ok("...and still the base set", base.every((h) => asset.includes(h)));
  check("...with no duplicates", new Set(asset).size, asset.length);
  ok(
    "no relayed response header can set cookies or redirect",
    ![...asset, ...base].some((h) => /set-cookie|location|refresh/i.test(h)),
  );

  const assetRoute = fs.readFileSync(
    path.join(DASHBOARD, "app", "api", "knowledge", "asset", "route.ts"),
    "utf8",
  );
  ok(
    "/api/knowledge/asset re-applies the asset allowlist to the upstream type",
    /hardenKnowledgeAssetHeaders\(\s*headers,\s*upstream\.headers\.get\(\s*["']content-type["']\s*\)\s*\)/.test(
      assetRoute,
    ),
  );
  ok(
    "...and never copies the upstream Content-Type through",
    !/set\(\s*["']Content-Type["']\s*,\s*upstream/i.test(assetRoute),
  );
  ok(
    "/api/pai re-applies it on the asset path",
    /if\s*\(\s*isKnowledgeAssetPath\(path\)\s*\)\s*\{\s*hardenKnowledgeAssetHeaders\(\s*respHeaders,/.test(
      fs.readFileSync(path.join(DASHBOARD, "app", "api", "pai", "[...path]", "route.ts"), "utf8"),
    ),
  );
  ok(
    "KNOWLEDGE_ASSET_RESPONSE_HEADERS names the sandbox CSP and the download",
    KNOWLEDGE_ASSET_RESPONSE_HEADERS.includes("content-security-policy") &&
      KNOWLEDGE_ASSET_RESPONSE_HEADERS.includes("content-disposition"),
  );
}

/* ── 5c. the asset MIME allowlist ───────────────────────────────────── */

section("asset Content-Type: exact allowlist, never the pack's string");
{
  // Headless Chrome ran script for the first three under the old regex.
  for (const raw of [
    "image/png;a,text/html",
    "text/css;,text/html",
    'video/mp4;x="a",text/html',
    "image/png,text/html",
    "image/png, text/html",
    'image/png;charset="x,text/html"',
    'image/png;"',
    "audio/ogg;codecs=opus,text/html",
    "image/png\r\nContent-Type: text/html",
    "image/png\nX: y",
    "image/png\u0000",
    "image/pngx",
    "image /png",
    "image/svg+xml",
    "image/svg+xml;foo=image/png",
    "text/html;image/png",
    ";image/png",
    "text/html",
    "application/xhtml+xml",
    "text/css",
    "text/vtt;,text/html",
    "text/vtt,text/html",
    'text/vtt;x="a",text/html',
    "application/pdf",
    "application/javascript",
    "",
    null,
    undefined,
  ]) {
    const got = knowledgeAssetContentType(raw);
    ok(
      `${JSON.stringify(raw)} is an octet-stream attachment`,
      got.contentType === "application/octet-stream" && got.inline === false,
    );
  }
  for (const [raw, clean] of [
    ["image/png", "image/png"],
    [" IMAGE/PNG ", "image/png"],
    ["image/png; q=1", "image/png"],
    ["image/jpg", "image/jpeg"],
    ["video/mp4; codecs=avc1", "video/mp4"],
    ["audio/x-wav", "audio/wav"],
    ["application/font-woff", "font/woff"],
    ["text/vtt", "text/vtt"],
    ["TEXT/VTT; charset=utf-8", "text/vtt"],
  ]) {
    const got = knowledgeAssetContentType(raw);
    ok(
      `${JSON.stringify(raw)} is inline as ${clean}`,
      got.contentType === clean && got.inline === true,
    );
  }
  ok(
    "every inline type is image, audio, video, font or text/vtt, and never SVG",
    Object.values(INLINE_ASSET_TYPES).every(
      (t) =>
        (/^(image|audio|video|font)\/[a-z0-9.+-]+$/.test(t) || t === "text/vtt") &&
        t !== "image/svg+xml",
    ),
  );
  ok(
    "no inherited key is honoured",
    knowledgeAssetContentType("constructor").inline === false &&
      knowledgeAssetContentType("__proto__").inline === false,
  );
  check("the asset CSP", KNOWLEDGE_ASSET_CSP, "default-src 'none'; sandbox");

  const bad = new Headers({ "Content-Disposition": "inline" });
  hardenKnowledgeAssetHeaders(bad, "image/png;a,text/html");
  check("harden: smuggled type -> octet-stream", bad.get("content-type"), "application/octet-stream");
  check("...attachment", bad.get("content-disposition"), "attachment");
  check("...nosniff", bad.get("x-content-type-options"), "nosniff");
  check("...sandbox CSP", bad.get("content-security-policy"), KNOWLEDGE_ASSET_CSP);

  const good = new Headers({ "Content-Disposition": "attachment" });
  hardenKnowledgeAssetHeaders(good, "image/png; q=1");
  check("harden: image/png stays inline with the clean type", good.get("content-type"), "image/png");
  check("...no Content-Disposition", good.get("content-disposition"), null);
  check("...still nosniff", good.get("x-content-type-options"), "nosniff");
  check("...still the sandbox CSP", good.get("content-security-policy"), KNOWLEDGE_ASSET_CSP);

  const dup = new Headers();
  dup.append("Content-Type", "image/png");
  dup.append("Content-Type", "text/html");
  check(
    "duplicate upstream Content-Type headers (joined with ', ') fail closed",
    knowledgeAssetContentType(dup.get("content-type")).inline,
    false,
  );
}

/* ── done ──────────────────────────────────────────────────────────── */

try {
  fs.rmSync(DIR, { recursive: true, force: true });
} catch {
  /* best effort */
}

console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0, `${fail} proxy-header assertions failed`);
