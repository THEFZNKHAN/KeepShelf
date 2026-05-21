/**
 * Injected into keep.google.com MAIN world via chrome.scripting.executeScript.
 * Must not reference imports. Chrome serializes this function.
 */
export function keepPageAction(
  action: "prepare" | "commit" | "verify",
  noteId: string,
  text = "",
  editedBefore = ""
): Promise<{
  ok: boolean;
  duplicate?: boolean;
  error?: string;
  editedBefore?: string;
}> {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

  const parseId = (url: string) => {
    const match =
      url.match(/#(?:NOTE|LIST)\/([^/?#\s]+)/i) ??
      url.match(/\/(?:NOTE|LIST)\/([^/?#\s]+)/i);
    return match?.[1];
  };

  const noteIdMatches = (current: string | undefined, expected: string) => {
    if (!current) return true;
    if (current === expected) return true;
    const prefix = expected.slice(0, 16);
    if (prefix.length >= 12 && current.startsWith(prefix)) return true;
    return current.includes(expected) || expected.includes(current);
  };

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const isVisible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };

  const ROOT_SELECTORS =
    ".IZ65Hb-s2gQvd, .IZ65Hb-n0tgWb, .VIpgJd-TUo6Hb";

  const LIST_FIELD_SELECTORS = [
    ".IZ65Hb-vIzZGf-L9AdLc-haAclf",
    '[contenteditable="true"][aria-label="list item"]',
    '[contenteditable="true"][role="combobox"]',
  ].join(", ");

  const findEditorRoots = () =>
    Array.from(document.querySelectorAll(ROOT_SELECTORS)).filter(isVisible);

  const isListField = (el: Element) => {
    if (!el.matches('[contenteditable="true"]')) return false;
    if (el.matches('[role="textbox"]')) return false;
    if (el.getAttribute("aria-label") === "list item") return true;
    if (el.getAttribute("role") === "combobox") return true;
    if (el.matches(".IZ65Hb-vIzZGf-L9AdLc-haAclf")) return true;
    return false;
  };

  const listFieldsIn = (scope: ParentNode) =>
    Array.from(scope.querySelectorAll<HTMLElement>(LIST_FIELD_SELECTORS)).filter(
      (el) => isListField(el) && isVisible(el)
    );

  const findAddButtonIn = (scope: ParentNode) => {
    const buttons = Array.from(
      scope.querySelectorAll<HTMLElement>('[aria-label="Add list item"]')
    ).filter(isVisible);
    return buttons[0] ?? null;
  };

  const scoreRoot = (root: Element) => {
    const listCount = listFieldsIn(root).length;
    const addBtn = findAddButtonIn(root);
    const title = root.querySelector('[contenteditable="true"][role="textbox"]');
    if (!title) return -1;
    if (listCount === 0 && !addBtn) return -1;
    return listCount * 100 + (addBtn ? 50 : 0) + root.getBoundingClientRect().width;
  };

  const findBestRoot = () => {
    let best: Element | null = null;
    let bestScore = -1;
    for (const root of findEditorRoots()) {
      const score = scoreRoot(root);
      if (score > bestScore) {
        bestScore = score;
        best = root;
      }
    }
    return best;
  };

  const listFields = (root: Element | null) => {
    if (root) {
      const scoped = listFieldsIn(root);
      if (scoped.length > 0) return scoped;
    }
    return listFieldsIn(document);
  };

  const readFieldText = (field: HTMLElement) => {
    const fromField = normalize(field.innerText || field.textContent || "");
    if (fromField) return fromField;
    const paragraph = field.querySelector("p");
    return paragraph
      ? normalize(paragraph.innerText || paragraph.textContent || "")
      : "";
  };

  const getEditedLabel = (root: Element) =>
    root.querySelector(".IZ65Hb-jfdpUb-fmcmS")?.textContent?.trim() ?? "";

  const collectAllListTexts = (root: Element) => {
    const texts: string[] = [];
    for (const row of root.querySelectorAll(".MPu53c-bN97Pc-sM5MNb")) {
      const field = row.querySelector<HTMLElement>(LIST_FIELD_SELECTORS);
      if (field) {
        const line = readFieldText(field);
        if (line) texts.push(line);
      }
    }
    for (const field of listFields(root)) {
      const line = readFieldText(field);
      if (line && !texts.includes(line)) texts.push(line);
    }
    return texts;
  };

  const textMatchesTarget = (candidate: string, targetText: string) => {
    if (!candidate) return false;
    if (candidate === targetText) return true;
    if (candidate.includes(targetText) || targetText.includes(candidate)) return true;
    const prefix = targetText.slice(0, 24);
    return prefix.length >= 12 && candidate.startsWith(prefix);
  };

  const isFieldEmpty = (field: HTMLElement) => {
    const text = readFieldText(field);
    if (!text) return true;
    const paragraph = field.querySelector("p");
    if (!paragraph) return false;
    const html = paragraph.innerHTML.trim().toLowerCase();
    return html === "" || html === "<br>" || html.startsWith("<br");
  };

  const placeCaretAtEnd = (target: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const focusListField = async (field: HTMLElement) => {
    const row = field.closest(".MPu53c-bN97Pc-sM5MNb") as HTMLElement | null;
    if (row) {
      row.click();
      await wait(80);
    }

    field.scrollIntoView({ block: "center" });
    field.click();
    field.focus();
    await wait(120);

    const paragraph = field.querySelector("p");
    const target = (paragraph ?? field) as HTMLElement;
    target.focus();
    placeCaretAtEnd(target);
  };

  const clickEmptyRow = (root: Element) => {
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>(".MPu53c-bN97Pc-sM5MNb")
    ).filter(isVisible);
    for (const row of rows) {
      const field = row.querySelector<HTMLElement>(LIST_FIELD_SELECTORS);
      if (field && isFieldEmpty(field)) {
        return field;
      }
    }
    return null;
  };

  const prepareListField = async (root: Element, targetText: string) => {
    const editedLabel = getEditedLabel(root);
    let fields = listFields(root);

    for (const field of fields) {
      if (textMatchesTarget(readFieldText(field), targetText)) {
        return { ok: true, duplicate: true, editedBefore: editedLabel };
      }
    }

    let field = fields.find(isFieldEmpty) ?? clickEmptyRow(root);
    if (!field) {
      findAddButtonIn(root)?.click();
      await wait(700);
      fields = listFields(root);
      field = fields.find(isFieldEmpty) ?? clickEmptyRow(root) ?? fields.at(-1);
    }

    if (!field) {
      return {
        ok: false,
        error: "No list item field found. Click your list note open, then retry.",
      };
    }

    await focusListField(field);
    await wait(150);

    return { ok: true, editedBefore: editedLabel };
  };

  const commitListItem = async (root: Element) => {
    const addBtn = findAddButtonIn(root);
    if (!addBtn) {
      return { ok: false, error: "Could not find Add list item in Keep." };
    }
    addBtn.click();
    await wait(700);
    return { ok: true };
  };

  const verifyListItem = async (
    root: Element,
    targetText: string,
    editedBefore: string
  ) => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const allText = collectAllListTexts(root);
      const hasText = allText.some((line) => textMatchesTarget(line, targetText));
      const editedNow = getEditedLabel(root);
      if (hasText && editedNow && editedNow !== editedBefore) {
        return { ok: true };
      }
      if (hasText && attempt >= 4) {
        return { ok: true };
      }
      await wait(250);
    }

    const allText = collectAllListTexts(root);
    if (allText.some((line) => textMatchesTarget(line, targetText))) {
      return { ok: true };
    }

    return {
      ok: false,
      error: "Keep did not save the list item after typing.",
    };
  };

  const waitForReadyRoot = async (expectedNoteId: string) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const root = findBestRoot();
      if (root) {
        const currentId =
          parseId(location.href) ?? parseId(location.hash) ?? undefined;
        if (noteIdMatches(currentId, expectedNoteId)) {
          return root;
        }
      }
      await wait(250);
    }
    return findBestRoot();
  };

  return (async () => {
    const root = await waitForReadyRoot(noteId);
    if (!root) {
      return {
        ok: false,
        error: "Keep note editor did not load. Open your list note in Keep first.",
      };
    }

    const targetText = normalize(text);

    if (action === "prepare") {
      const prep = await prepareListField(root, targetText);
      if (!prep.ok || prep.duplicate) {
        return prep;
      }

      return { ok: true, editedBefore: prep.editedBefore };
    }

    if (action === "commit") {
      return commitListItem(root);
    }

    return verifyListItem(root, targetText, editedBefore);
  })();
}
