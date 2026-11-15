/**
 * The Trakt connection: signing in (PKCE), keeping the token fresh, and sending what changed on the shelf.
 * The pure parts are in shared/trakt-auth.ts and shared/trakt-sync.ts.
 */
import {
  TRAKT_API_BASE,
  TRAKT_AUTH_BASE,
  apiHeaders,
  authorizeUrl,
  challengeFor,
  cleanClientId,
  codeExchangeBody,
  codeFromRedirect,
  makeState,
  makeVerifier,
  needsRefresh,
  parseTokens,
  refreshBody,
  retryAfterMs,
  sanitizeTokens,
  type TraktTokens,
} from "../shared/trakt-auth.js";
import {
  batches,
  buildBodies,
  changeKey,
  notFoundIn,
  pendingChanges,
  seedFromWatched,
  type SyncOptions,
  type TraktChange,
  type TraktItemState,
  type TraktSent,
  type TraktStatus,
  type TraktPreview,
  type KeptRating,
  buildPreview,
  keepTraktRatings,
  ratingsFrom,
} from "../shared/trakt-sync.js";
import { STORAGE_KEY, getAllItems } from "../shared/storage.js";
import type { SavedItem } from "../shared/types.js";

const SETTINGS_KEY = "keepshelf_trakt";
const AUTH_KEY = "keepshelf_trakt_auth";
const STATE_KEY = "keepshelf_trakt_state";
export const TRAKT_ALARM = "keepshelf-trakt-sync";

/** Spacing between write calls: Trakt allows one per second per user. */
const WRITE_GAP_MS = 1100;

interface TraktSettings {
  clientId?: string;
  /** Send changes as they happen. */
  auto: boolean;
  /** Keep the Trakt watchlist in step with "To watch". */
  watchlist: boolean;
}

interface TraktAuth {
  tokens: TraktTokens;
  username?: string;
}

interface TraktState {
  /** What Trakt already had has been read, so the first send doesn't add second plays. */
  seeded?: boolean;
  /** "Send everything" has run once since connecting; until then nothing is sent automatically. */
  ready?: boolean;
  lastRun?: number;
  lastMessage?: string;
  lastError?: string;
  /** What a send is doing right now, for the Settings card. */
  progress?: string;
}

export class TraktError extends Error {}

/* ── Storage ─────────────────────────────────────────────── */

async function getSettings(): Promise<TraktSettings> {
  const raw = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<TraktSettings> | undefined;
  return {
    ...(cleanClientId(raw?.clientId) ? { clientId: cleanClientId(raw?.clientId) } : {}),
    auto: raw?.auto !== false,
    watchlist: raw?.watchlist === true,
  };
}

async function saveSettings(settings: TraktSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function getAuth(): Promise<TraktAuth | undefined> {
  const raw = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY] as { tokens?: unknown; username?: unknown } | undefined;
  const tokens = sanitizeTokens(raw?.tokens);
  if (!tokens) return undefined;
  const username = typeof raw?.username === "string" && /^[\w.-]{1,60}$/.test(raw.username) ? raw.username : undefined;
  return { tokens, ...(username ? { username } : {}) };
}

async function getState(): Promise<TraktState> {
  return ((await chrome.storage.local.get(STATE_KEY))[STATE_KEY] as TraktState | undefined) ?? {};
}

async function setState(patch: Partial<TraktState>): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: { ...(await getState()), ...patch } });
}

/** Item writes go through the background's one-at-a-time queue, set by main.ts. */
let serial: <T>(task: () => Promise<T>) => Promise<T> = (task) => task();
export function useSerialQueue(run: <T>(task: () => Promise<T>) => Promise<T>): void {
  serial = run;
}

/** Writes each title's Trakt record in one go, reading the shelf fresh so nothing else is overwritten. */
async function writeItemStates(states: Map<string, TraktItemState | undefined>): Promise<void> {
  if (states.size === 0) return;
  await serial(async () => {
    const items = await getAllItems();
    const next = items.map((item) => {
      if (!states.has(item.id)) return item;
      const state = states.get(item.id);
      const { trakt: _old, ...rest } = item;
      return state ? { ...rest, trakt: state } : rest;
    });
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  });
}

/* ── Requests ────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function redirectUri(): string {
  return chrome.identity.getRedirectURL("trakt");
}

async function oauthError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; error_description?: unknown };
    const text = typeof body.error_description === "string" ? body.error_description : typeof body.error === "string" ? body.error : "";
    if (text) return `Trakt refused the sign-in: ${text.slice(0, 160)}`;
  } catch {
    /* no details */
  }
  return `Trakt refused the sign-in (${response.status}).`;
}

async function tokenRequest(body: object, clientId: string): Promise<TraktTokens> {
  const response = await timedFetch(`${TRAKT_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: apiHeaders(clientId),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new TraktError(await oauthError(response));
  const tokens = parseTokens(await response.json(), Date.now());
  if (!tokens) throw new TraktError("Trakt's sign-in answer was missing its tokens.");
  return tokens;
}

/** Refresh tokens work once, so two refreshes must never run at the same time. */
let refreshing: Promise<TraktTokens> | undefined;

async function freshTokens(clientId: string, force = false): Promise<TraktTokens> {
  const auth = await getAuth();
  if (!auth) throw new TraktError("Not connected to Trakt.");
  if (!force && !needsRefresh(auth.tokens, Date.now())) return auth.tokens;
  refreshing ??= (async () => {
    try {
      const tokens = await tokenRequest(refreshBody({ refreshToken: auth.tokens.refreshToken, clientId, redirectUri: redirectUri() }), clientId);
      await chrome.storage.local.set({ [AUTH_KEY]: { ...auth, tokens } });
      return tokens;
    } catch (err) {
      // A refresh token that no longer works means signing in again.
      if (err instanceof TraktError) await setState({ lastError: "Trakt sign-in expired. Connect again in Settings." });
      throw err;
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

/** How long one request may take before it is given up. */
const REQUEST_TIMEOUT_MS = 30000;
/** A rate-limit wait longer than this stops the send instead of sitting silently. */
const MAX_RATE_WAIT_MS = 60000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new TraktError("Trakt didn't answer in time. Try again in a moment.");
    }
    throw new TraktError("Couldn't reach Trakt. Check your connection.");
  }
}

/** An API call with the token, retrying on a short rate limit and once after refreshing an expired token. */
async function api<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  const { clientId } = await getSettings();
  if (!clientId) throw new TraktError("Add your Trakt Client ID in Settings first.");
  let tokens = await freshTokens(clientId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await timedFetch(`${TRAKT_API_BASE}${path}`, {
      method,
      headers: apiHeaders(clientId, tokens.accessToken),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // One line per request in the service worker console, to see where a send stands. No tokens or titles.
    console.info(`[KeepShelf Trakt] ${method} ${path} -> ${response.status}`);
    if (response.status === 429) {
      const wait = retryAfterMs(response.headers.get("Retry-After"), attempt);
      if (wait > MAX_RATE_WAIT_MS) {
        throw new TraktError(`Trakt asked KeepShelf to wait ${Math.ceil(wait / 60000)} min. Press Send again after that.`);
      }
      await setState({ progress: `Trakt asked to slow down; waiting ${Math.ceil(wait / 1000)} s…` });
      await sleep(wait);
      continue;
    }
    if (response.status === 401 && attempt === 0) {
      tokens = await freshTokens(clientId, true);
      continue;
    }
    if (response.status === 420) {
      throw new TraktError("Your Trakt account limit is full (on a free account this is usually the watchlist). Turn off watchlist sync or make room on Trakt.");
    }
    if (response.status === 403) throw new TraktError("Trakt refused the Client ID. Check it in Settings.");
    if (response.status === 423) throw new TraktError("Your Trakt account is locked.");
    if (!response.ok) throw new TraktError(`Trakt answered ${response.status}. Try again later.`);
    const text = await response.text();
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      throw new TraktError("Trakt sent an answer KeepShelf couldn't read.");
    }
  }
  throw new TraktError("Trakt is busy. It will be tried again on the next change.");
}

/* ── Connecting ──────────────────────────────────────────── */

export async function setClientId(value: string): Promise<void> {
  const trimmed = value.trim();
  const settings = await getSettings();
  if (trimmed === "") {
    await disconnect();
    const { clientId: _gone, ...rest } = settings;
    await saveSettings(rest);
    return;
  }
  const clientId = cleanClientId(trimmed);
  if (!clientId) throw new TraktError("That doesn't look like a Trakt Client ID. Copy it from your app page on Trakt.");
  if (clientId !== settings.clientId) await disconnect();
  await saveSettings({ ...settings, clientId });
}

export async function setOptions(options: { auto?: boolean; watchlist?: boolean }): Promise<void> {
  const settings = await getSettings();
  await saveSettings({
    ...settings,
    ...(typeof options.auto === "boolean" ? { auto: options.auto } : {}),
    ...(typeof options.watchlist === "boolean" ? { watchlist: options.watchlist } : {}),
  });
}

/** Opens Trakt's sign-in window, then swaps the code for tokens. */
export async function connect(): Promise<string | undefined> {
  const { clientId } = await getSettings();
  if (!clientId) throw new TraktError("Add your Trakt Client ID first.");
  const redirect = redirectUri();
  const verifier = makeVerifier(crypto.getRandomValues(new Uint8Array(48)));
  const state = makeState(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = await challengeFor(verifier, crypto.subtle);
  let answer: string | undefined;
  try {
    answer = await chrome.identity.launchWebAuthFlow({
      url: authorizeUrl({ clientId, redirectUri: redirect, challenge, state }),
      interactive: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    throw new TraktError(/did not approve|cancel|closed/i.test(message) ? "Sign-in was cancelled." : `Trakt sign-in didn't finish. Check that the redirect URI on your Trakt app page is ${redirect}`);
  }
  if (!answer) throw new TraktError("Sign-in was cancelled.");
  const result = codeFromRedirect(answer, redirect, state);
  if ("error" in result) throw new TraktError(result.error);
  const tokens = await tokenRequest(codeExchangeBody({ code: result.code, clientId, redirectUri: redirect, verifier }), clientId);
  await chrome.storage.local.set({ [AUTH_KEY]: { tokens } });
  await chrome.storage.local.set({ [STATE_KEY]: {} });

  let username: string | undefined;
  try {
    const me = await api<{ user?: { username?: unknown } }>("/users/settings");
    const name = me?.user?.username;
    if (typeof name === "string" && /^[\w.-]{1,60}$/.test(name)) username = name;
  } catch {
    /* the name is only for showing */
  }
  if (username) await chrome.storage.local.set({ [AUTH_KEY]: { tokens, username } });
  return username;
}

/** Signs out: revokes the token on Trakt (best effort) and forgets what was sent, since another account may follow. */
export async function disconnect(): Promise<void> {
  const auth = await getAuth();
  const { clientId } = await getSettings();
  if (auth && clientId) {
    try {
      await timedFetch(`${TRAKT_AUTH_BASE}/oauth/revoke`, {
        method: "POST",
        headers: apiHeaders(clientId),
        body: JSON.stringify({ token: auth.tokens.accessToken, client_id: clientId }),
      });
    } catch {
      /* signing out here still works */
    }
  }
  await chrome.storage.local.remove([AUTH_KEY, STATE_KEY]);
  await serial(async () => {
    const items = await getAllItems();
    if (!items.some((i) => i.trakt)) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: items.map(({ trakt: _t, ...rest }) => rest) });
  });
}

/* ── Sending ─────────────────────────────────────────────── */

let running: Promise<void> | undefined;
let again = false;

function itemsById(items: SavedItem[]): Map<string, SavedItem> {
  return new Map(items.map((i) => [i.id, i]));
}

/** What has been sent after the parts of a change that went through. */
function sentAfter(before: TraktSent, change: TraktChange, parts: { history: boolean; ratings: boolean; watchlist: boolean }): TraktSent {
  const out: TraktSent = { ...before };
  if (parts.history) {
    if (change.next.movie) out.movie = true;
    if (change.next.seasons) out.seasons = change.next.seasons;
  }
  if (parts.ratings) {
    if (change.next.rating === undefined) delete out.rating;
    else out.rating = change.next.rating;
  }
  if (parts.watchlist && change.watchlist) out.watchlist = change.next.watchlist;
  return out;
}

/**
 * Reads what Trakt already has (watched movies and shows, and ratings) and works out what counts as sent. Read-only:
 * nothing is written here, to Trakt or to the shelf.
 */
async function readTrakt(items: SavedItem[], options: SyncOptions): Promise<{ sent: Map<string, TraktSent>; kept: KeptRating[] }> {
  const movies = await api<unknown>("/sync/watched/movies");
  const shows = await api<unknown>("/sync/watched/shows");
  const ratedMovies = await api<unknown>("/sync/ratings/movies");
  const ratedShows = await api<unknown>("/sync/ratings/shows");
  const sent = seedFromWatched(items, movies, shows, options);
  const kept = keepTraktRatings(items, sent, ratingsFrom(ratedMovies, ratedShows));
  return { sent, kept };
}

async function seed(options: SyncOptions): Promise<void> {
  const items = await getAllItems();
  const { sent } = await readTrakt(items, options);
  const byId = itemsById(items);
  const states = new Map<string, TraktItemState | undefined>();
  for (const [id, value] of sent) states.set(id, { ...(byId.get(id)?.trakt ?? {}), sent: value });
  await writeItemStates(states);
  await setState({ seeded: true });
}

/** What a send would do right now, without sending or saving anything. */
export async function previewTrakt(): Promise<TraktPreview> {
  const settings = await getSettings();
  if (!settings.clientId || !(await getAuth())) throw new TraktError("Connect to Trakt first.");
  const options: SyncOptions = { watchlist: settings.watchlist };
  let items = await getAllItems();
  let kept: KeptRating[] = [];
  if (!(await getState()).seeded) {
    const read = await readTrakt(items, options);
    kept = read.kept;
    items = items.map((i) => (read.sent.has(i.id) ? { ...i, trakt: { ...(i.trakt ?? {}), sent: read.sent.get(i.id) } } : i));
  }
  return buildPreview(pendingChanges(items, options), kept);
}

async function sendBatch(batch: TraktChange[], mode: "now" | "catchup", label: string): Promise<number> {
  const bodies = buildBodies(batch, mode, Date.now());
  const done = { history: !bodies.history, ratings: !bodies.ratings && !bodies.ratingsRemove, watchlist: !bodies.watchlist && !bodies.watchlistRemove };
  const missing = new Set<string>();
  let failure: unknown;
  const post = async (path: string, body: unknown) => {
    await setState({ progress: `${label}: ${path.replace("/sync/", "").replace("/", " ")}…` });
    const answer = await api<unknown>(path, "POST", body);
    for (const key of notFoundIn(answer)) missing.add(key);
    await sleep(WRITE_GAP_MS);
  };
  try {
    if (bodies.history) {
      await post("/sync/history", bodies.history);
      done.history = true;
    }
    if (bodies.ratings) await post("/sync/ratings", bodies.ratings);
    if (bodies.ratingsRemove) await post("/sync/ratings/remove", bodies.ratingsRemove);
    done.ratings = true;
    if (bodies.watchlist) await post("/sync/watchlist", bodies.watchlist);
    if (bodies.watchlistRemove) await post("/sync/watchlist/remove", bodies.watchlistRemove);
    done.watchlist = true;
  } catch (err) {
    failure = err;
  }

  // Record what went through, even when a later part failed: history sent twice would add a second play.
  const byId = itemsById(await getAllItems());
  const states = new Map<string, TraktItemState | undefined>();
  const now = Date.now();
  for (const change of batch) {
    const item = byId.get(change.id);
    if (!item) continue;
    const sent = sentAfter(item.trakt?.sent ?? {}, change, done);
    const notFound = missing.has(changeKey(change));
    states.set(change.id, {
      sent,
      at: now,
      ...(notFound ? { problem: change.kind === "movie" ? "Not found on Trakt" : "Trakt couldn't match this show or some of its episodes" } : {}),
    });
  }
  await writeItemStates(states);
  if (failure) throw failure;
  return batch.length;
}

/**
 * Sends what changed. `catchup` is the "Send everything" button: older watches get their air dates, and from then on
 * changes are sent automatically. An automatic run before that does nothing, so a first connection doesn't date a whole
 * library to today.
 */
export async function syncTrakt(mode: "auto" | "catchup"): Promise<void> {
  if (running) {
    if (mode === "auto") again = true;
    return running;
  }
  running = (async () => {
    const settings = await getSettings();
    const auth = await getAuth();
    const state = await getState();
    if (!settings.clientId || !auth) return;
    if (mode === "auto" && (!settings.auto || !state.ready)) return;
    const options: SyncOptions = { watchlist: settings.watchlist };
    try {
      if (!state.seeded) {
        await setState({ progress: "Reading what Trakt already has…" });
        await seed(options);
      }
      const changes = pendingChanges(await getAllItems(), options);
      const parts = batches(changes);
      let sent = 0;
      for (const [index, batch] of parts.entries()) {
        sent += await sendBatch(batch, mode === "catchup" ? "catchup" : "now", `Part ${index + 1} of ${parts.length}`);
      }
      await setState({
        lastRun: Date.now(),
        lastError: undefined,
        lastMessage: sent === 0 ? "Trakt is up to date." : `Sent ${sent} title${sent === 1 ? "" : "s"} to Trakt.`,
        progress: undefined,
        ...(mode === "catchup" ? { ready: true } : {}),
      });
    } catch (err) {
      await setState({ lastRun: Date.now(), lastError: err instanceof Error ? err.message : "Sending to Trakt failed.", progress: undefined });
      if (mode === "catchup") throw err;
    }
  })();
  try {
    await running;
  } finally {
    running = undefined;
    if (again) {
      again = false;
      void syncTrakt("auto").catch(() => undefined);
    }
  }
}

/** Sends soon after a change, coalescing quick edits. The alarm is a fallback in case the worker sleeps first. */
let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleTraktSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void syncTrakt("auto").catch(() => undefined);
  }, 4000);
  void chrome.alarms.create(TRAKT_ALARM, { delayInMinutes: 1 });
}

export async function traktStatus(): Promise<TraktStatus> {
  const settings = await getSettings();
  const auth = await getAuth();
  const state = await getState();
  const items = await getAllItems();
  const connected = !!(settings.clientId && auth);
  const pending = connected && state.seeded ? pendingChanges(items, { watchlist: settings.watchlist }).length : 0;
  return {
    ...(settings.clientId ? { clientId: settings.clientId } : {}),
    connected,
    ...(auth?.username ? { username: auth.username } : {}),
    redirectUri: redirectUri(),
    auto: settings.auto,
    watchlist: settings.watchlist,
    ready: !!state.ready,
    running: !!running,
    ...(running && state.progress ? { progress: state.progress } : {}),
    ...(state.lastRun ? { lastRun: state.lastRun } : {}),
    ...(state.lastMessage ? { lastMessage: state.lastMessage } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {}),
    pending,
    problems: items
      .filter((i) => i.trakt?.problem)
      .map((i) => ({ id: i.id, title: i.title, problem: i.trakt!.problem! })),
  };
}
