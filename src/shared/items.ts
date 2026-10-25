import type { SavedItem } from "./types.js";

export type NewItem = Omit<SavedItem, "id" | "savedAt">;

export function isHttpUrl(value: string): boolean {
  try {
    const p = new URL(value.trim());
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

export function linkItem(url: string): NewItem {
  return {
    type: "link",
    title: new URL(url).hostname.replace(/^www\./, ""),
    url,
    sourceUrl: url,
    googleQuery: url,
    subtitle: url,
  };
}

export function noteItem(text: string): NewItem {
  return {
    type: "note",
    title: text.length > 60 ? text.slice(0, 59) + "…" : text,
    body: text,
    sourceUrl: "",
    googleQuery: text,
    subtitle: text,
  };
}

export function tabItem(title: string | undefined, url: string): NewItem {
  return {
    type: "tab",
    title: title?.trim() || "Untitled tab",
    url,
    sourceUrl: url,
    googleQuery: url,
    subtitle: url,
  };
}

export function isSaveableTabUrl(url: string | undefined): url is string {
  return Boolean(
    url &&
      !url.startsWith("chrome://") &&
      !url.startsWith("chrome-extension://") &&
      !url.startsWith("edge://") &&
      !url.startsWith("about:")
  );
}
