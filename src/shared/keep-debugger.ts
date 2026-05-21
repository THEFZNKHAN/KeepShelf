function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachDebugger(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function detachDebugger(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function debuggerCommand(
  tabId: number,
  method: string,
  params?: object
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

/** Sends trusted keyboard input so Google Keep persists the list item. */
export async function trustedInsertTextInKeep(
  tabId: number,
  text: string
): Promise<void> {
  await attachDebugger(tabId);
  try {
    await debuggerCommand(tabId, "Input.insertText", { text });
    await sleep(300);
  } finally {
    try {
      await detachDebugger(tabId);
    } catch {
      /* ignore */
    }
  }
}
