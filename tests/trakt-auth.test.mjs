import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiHeaders, authorizeUrl, challengeFor, cleanClientId, codeExchangeBody, codeFromRedirect, makeVerifier, needsRefresh,
  parseTokens, refreshBody, retryAfterMs, sanitizeTokens,
} from "../dist-test/trakt-auth.js";

// Fake values only.
const CLIENT = "fake0client0id0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/trakt";

test("a client id is accepted only when it looks like one", () => {
  assert.equal(cleanClientId(`  ${CLIENT}  `), CLIENT);
  assert.equal(cleanClientId("short"), undefined);
  assert.equal(cleanClientId("has spaces in it and is long enough"), undefined);
  assert.equal(cleanClientId("abc&redirect_uri=https://evil.example/aaaa"), undefined);
  assert.equal(cleanClientId(42), undefined);
});

test("the verifier is 43-128 allowed characters, and the challenge is its S256 hash", async () => {
  const verifier = makeVerifier(new Uint8Array(48).fill(7));
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.throws(() => makeVerifier(new Uint8Array(8)));
  // RFC 7636 appendix B test vector.
  const challenge = await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", globalThis.crypto.subtle);
  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("the authorize address goes to auth.trakt.tv with every PKCE parameter", () => {
  const url = new URL(authorizeUrl({ clientId: CLIENT, redirectUri: REDIRECT, challenge: "CH", state: "ST" }));
  assert.equal(url.origin + url.pathname, "https://auth.trakt.tv/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), CLIENT);
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
  assert.equal(url.searchParams.get("code_challenge"), "CH");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "ST");
  // The account is always chosen on Trakt's sign-in page, never taken silently from the browser.
  assert.equal(url.searchParams.get("prompt"), "login");
});

test("the code is taken only from our own address with the right state", () => {
  assert.deepEqual(codeFromRedirect(`${REDIRECT}?code=abc123&state=ST`, REDIRECT, "ST"), { code: "abc123" });
  assert.ok("error" in codeFromRedirect(`${REDIRECT}?code=abc123&state=OTHER`, REDIRECT, "ST"));
  assert.ok("error" in codeFromRedirect("https://evil.example/trakt?code=abc123&state=ST", REDIRECT, "ST"));
  assert.match(codeFromRedirect(`${REDIRECT}?error=access_denied&state=ST`, REDIRECT, "ST").error, /cancelled/);
  assert.ok("error" in codeFromRedirect(`${REDIRECT}?state=ST`, REDIRECT, "ST"));
  assert.ok("error" in codeFromRedirect("not a url", REDIRECT, "ST"));
});

test("the token requests send the verifier and never a client secret", () => {
  const exchange = codeExchangeBody({ code: "C", clientId: CLIENT, redirectUri: REDIRECT, verifier: "V" });
  assert.deepEqual(exchange, { code: "C", client_id: CLIENT, redirect_uri: REDIRECT, grant_type: "authorization_code", code_verifier: "V" });
  const refresh = refreshBody({ refreshToken: "R", clientId: CLIENT, redirectUri: REDIRECT });
  assert.equal(refresh.grant_type, "refresh_token");
  assert.equal("client_secret" in exchange || "client_secret" in refresh, false);
});

test("tokens are read from Trakt's answer and checked again when stored", () => {
  const now = 1_800_000_000_000;
  const t = parseTokens({ access_token: "acc.token-1", refresh_token: "ref.token-1", expires_in: 604800, created_at: now / 1000 }, now);
  assert.equal(t.expiresAt, now + 604800 * 1000);
  assert.deepEqual(sanitizeTokens(t), t);
  assert.equal(parseTokens({ access_token: "x" }, now), undefined);
  assert.equal(parseTokens({ access_token: "has spaces in it", refresh_token: "ref.token-1" }, now), undefined);
  assert.equal(sanitizeTokens({ accessToken: "acc.token-1" }), undefined);
  assert.equal(needsRefresh(t, now), false);
  assert.equal(needsRefresh(t, t.expiresAt - 1000), true);
});

test("API calls carry the key, version and token", () => {
  const h = apiHeaders(CLIENT, "TOKEN");
  assert.equal(h["trakt-api-key"], CLIENT);
  assert.equal(h["trakt-api-version"], "2");
  assert.equal(h.Authorization, "Bearer TOKEN");
  assert.equal("Authorization" in apiHeaders(CLIENT), false);
});

test("a 429 waits as long as Trakt says, within reason", () => {
  assert.equal(retryAfterMs("3", 0), 3000);
  assert.equal(retryAfterMs("9999", 0), 120000);
  const backoff = retryAfterMs(null, 2);
  assert.ok(backoff >= 4000 && backoff < 4500);
});
