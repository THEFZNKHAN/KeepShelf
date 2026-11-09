export const REMINDERS_KEY = "keepshelf_reminders_enabled";
export const NOTIFIED_KEY = "keepshelf_reminders_notified";

/** Off until the user turns it on, because it checks TMDB in the background and shows notifications. */
export async function isRemindersEnabled(): Promise<boolean> {
  return (await chrome.storage.local.get(REMINDERS_KEY))[REMINDERS_KEY] === true;
}

export async function setRemindersEnabled(enabled: boolean): Promise<boolean> {
  await chrome.storage.local.set({ [REMINDERS_KEY]: Boolean(enabled) });
  return Boolean(enabled);
}

/** Which releases were already announced, as "itemId:date" to that date. */
export async function getNotified(): Promise<Record<string, string>> {
  const raw = (await chrome.storage.local.get(NOTIFIED_KEY))[NOTIFIED_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
}

export async function setNotified(notified: Record<string, string>): Promise<void> {
  await chrome.storage.local.set({ [NOTIFIED_KEY]: notified });
}
