export const BOOK_INFO_KEY = "keepshelf_bookinfo_enabled";

/** Off until the user turns it on, because it sends titles and authors to openlibrary.org. */
export async function isBookInfoEnabled(): Promise<boolean> {
  return (await chrome.storage.local.get(BOOK_INFO_KEY))[BOOK_INFO_KEY] === true;
}

export async function setBookInfoEnabled(enabled: boolean): Promise<boolean> {
  await chrome.storage.local.set({ [BOOK_INFO_KEY]: Boolean(enabled) });
  return Boolean(enabled);
}
