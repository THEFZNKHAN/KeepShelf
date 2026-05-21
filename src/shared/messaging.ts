import type { MessageAction, MessageResponse } from "./types.js";

/** Send a message to the background worker, with a short retry while the SW wakes (MV3). */
export async function sendToBackground(
  message: MessageAction
): Promise<MessageResponse> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response !== undefined) {
        return response as MessageResponse;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (chrome.runtime.lastError) {
      lastError = new Error(chrome.runtime.lastError.message);
    }

    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
    }
  }

  const msg = lastError?.message ?? "";
  if (/no sw|receiving end does not exist|extension context invalidated/i.test(msg)) {
    throw new Error(
      "KeepShelf background is not running. Reload the extension at chrome://extensions."
    );
  }
  throw lastError ?? new Error("Failed to reach KeepShelf background.");
}
