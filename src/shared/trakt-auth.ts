/**
 * Signing in to Trakt with PKCE (no client secret). Everything here is pure; the background worker opens the sign-in
 * window and makes the requests. See https://developer.trakt.tv/docs/pkce.
 */

/** All OAuth requests (authorize, token, refresh, revoke) go to this host, never to the API host. */
export const TRAKT_AUTH_BASE = "https://auth.trakt.tv";
export const TRAKT_API_BASE = "https://api.trakt.tv";

/** Refresh a little before the access token runs out (Trakt's last for 7 days). */
export const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

export interface TraktTokens {
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working, in ms since the epoch. */
  expiresAt: number;
}

/** A Client ID as Trakt shows it: letters, digits and a few separators, nothing that could break a URL or header. */
export function isClientId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}

export function cleanClientId(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return isClientId(trimmed) ? trimmed : undefined;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A code verifier from random bytes: 48 bytes give 64 characters, inside Trakt's 43 to 128 of A-Z a-z 0-9 - _. */
export function makeVerifier(random: Uint8Array): string {
  if (random.length < 32) throw new Error("The verifier needs at least 32 random bytes.");
  return base64url(random);
}

/** The S256 challenge for a verifier: SHA-256, base64url without padding. */
export async function challengeFor(verifier: string, subtle: SubtleCrypto): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** A random value to tie the answer to this sign-in. */
export function makeState(random: Uint8Array): string {
  return base64url(random);
}

export function authorizeUrl(options: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    // Always show Trakt's sign-in page, so the account is chosen each time rather than taken from the browser.
    prompt: "login",
  });
  return `${TRAKT_AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

/**
 * Reads the code from the address Trakt sent the browser back to. It must be our redirect address and carry the state
 * we sent, or the answer is not for this sign-in.
 */
export function codeFromRedirect(url: string, redirectUri: string, state: string): { code: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Trakt sent back an address that isn't valid." };
  }
  if (!url.startsWith(redirectUri)) return { error: "Trakt sent the sign-in back to the wrong address." };
  const denied = parsed.searchParams.get("error");
  if (denied) return { error: denied === "access_denied" ? "Sign-in was cancelled on Trakt." : `Trakt refused the sign-in (${denied.slice(0, 60)}).` };
  if (parsed.searchParams.get("state") !== state) return { error: "The sign-in answer didn't match this request. Try again." };
  const code = parsed.searchParams.get("code");
  if (!code || !/^[A-Za-z0-9._~-]{1,512}$/.test(code)) return { error: "Trakt didn't send a sign-in code." };
  return { code };
}

/** The body that swaps the code for tokens. PKCE apps send the verifier and no client secret. */
export function codeExchangeBody(options: { code: string; clientId: string; redirectUri: string; verifier: string }) {
  return {
    code: options.code,
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    grant_type: "authorization_code",
    code_verifier: options.verifier,
  };
}

/** The body that swaps a refresh token for new tokens. The refresh token can be used only once. */
export function refreshBody(options: { refreshToken: string; clientId: string; redirectUri: string }) {
  return {
    refresh_token: options.refreshToken,
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    grant_type: "refresh_token",
  };
}

const isToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._~+/=-]{8,2048}$/.test(value);

/** Turns Trakt's token answer into what is stored. `created_at` and `expires_in` are in seconds. */
export function parseTokens(raw: unknown, now: number): TraktTokens | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!isToken(r.access_token) || !isToken(r.refresh_token)) return undefined;
  const expiresIn = typeof r.expires_in === "number" && r.expires_in > 0 ? r.expires_in : 7 * 24 * 60 * 60;
  const created = typeof r.created_at === "number" && r.created_at > 0 ? r.created_at * 1000 : now;
  return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Math.min(created, now) + expiresIn * 1000 };
}

/** Stored tokens, checked again when read back. */
export function sanitizeTokens(raw: unknown): TraktTokens | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!isToken(r.accessToken) || !isToken(r.refreshToken) || typeof r.expiresAt !== "number") return undefined;
  return { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt };
}

export function needsRefresh(tokens: TraktTokens, now: number, margin = REFRESH_MARGIN_MS): boolean {
  return tokens.expiresAt - now <= margin;
}

/** The headers every API call carries. (Trakt suggests a User-Agent, but a browser sets its own.) */
export function apiHeaders(clientId: string, accessToken?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "trakt-api-key": clientId,
    "trakt-api-version": "2",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

/** Seconds to wait after a 429: Retry-After when given (capped), otherwise a short backoff. */
export function retryAfterMs(header: string | null, attempt: number): number {
  const seconds = header && /^\d{1,4}$/.test(header.trim()) ? Number(header.trim()) : NaN;
  if (Number.isFinite(seconds)) return Math.min(seconds, 120) * 1000;
  return Math.min(1000 * 2 ** attempt, 30000) + Math.floor(Math.random() * 500);
}
