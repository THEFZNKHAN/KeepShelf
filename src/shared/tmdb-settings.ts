import { parseTmdbToken, type TmdbAuth } from "./tmdb.js";

export const TMDB_TOKEN_KEY = "keepshelf_tmdb_token";

export async function getTmdbAuth(): Promise<TmdbAuth | undefined> {
  const stored = (await chrome.storage.local.get(TMDB_TOKEN_KEY))[TMDB_TOKEN_KEY];
  return typeof stored === "string" ? parseTmdbToken(stored) : undefined;
}

/** Saves a token after checking its shape; an empty string removes it. */
export async function setTmdbToken(raw: string): Promise<boolean> {
  const value = raw.trim();
  if (!value) {
    await chrome.storage.local.remove(TMDB_TOKEN_KEY);
    return false;
  }
  if (!parseTmdbToken(value)) {
    throw new Error("That doesn't look like a TMDB token. Use the API Read Access Token (starts with eyJ) or the 32-character API key.");
  }
  await chrome.storage.local.set({ [TMDB_TOKEN_KEY]: value });
  return true;
}
