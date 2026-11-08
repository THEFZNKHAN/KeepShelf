import type { TagGroups } from "../shared/tag-filter.js";

export interface TagPicker {
  /** Replaces the tags on offer and the one currently chosen ("" means all). */
  setOptions(groups: TagGroups, selected: string): void;
  close(): void;
  isOpen(): boolean;
}

/** Show the search box once there are enough tags for scrolling alone to be tedious. */
const SEARCH_FROM = 8;

/**
 * A dropdown for choosing a tag. A native <select> can't be told how tall to be or to scroll, and Chrome draws
 * it outside the popup when the list is long, so this one is built from elements. It lists every tag, scrolls,
 * stays inside the popup, can be searched by typing, and works with the keyboard.
 */
export function createTagPicker(button: HTMLButtonElement, onSelect: (tag: string) => void): TagPicker {
  const labelEl = button.querySelector<HTMLElement>(".tag-button-label")!;
  let groups: TagGroups = { manual: [], genres: [] };
  let selected = "";
  let open = false;
  let query = "";
  let active = -1;
  let entries: Array<{ tag: string; el: HTMLElement }> = [];

  const panel = document.createElement("div");
  panel.className = "picker-panel";
  panel.id = "tag-panel";
  panel.hidden = true;
  const search = document.createElement("input");
  search.type = "search";
  search.className = "picker-search";
  search.placeholder = "Find a tag…";
  search.autocomplete = "off";
  search.setAttribute("aria-label", "Find a tag");
  const list = document.createElement("ul");
  list.className = "picker-list";
  list.id = "tag-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Tags");
  list.tabIndex = -1;
  panel.append(search, list);
  document.body.append(panel);
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-controls", "tag-panel");
  button.setAttribute("aria-expanded", "false");

  const total = (): number => groups.manual.length + groups.genres.length;

  function makeOption(tag: string, text: string, count?: number): HTMLElement {
    const li = document.createElement("li");
    li.className = "picker-option";
    li.id = `tag-option-${entries.length}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(tag === selected));
    li.dataset.tag = tag;
    li.append(Object.assign(document.createElement("span"), { className: "picker-option-text", textContent: text }));
    if (count !== undefined) li.append(Object.assign(document.createElement("span"), { className: "picker-count", textContent: String(count) }));
    li.addEventListener("pointerenter", () => setActive(entries.findIndex((e) => e.el === li), false));
    li.addEventListener("click", () => choose(tag));
    return li;
  }

  function heading(text: string): HTMLElement {
    const li = document.createElement("li");
    li.className = "picker-group";
    li.setAttribute("role", "presentation");
    li.textContent = text;
    return li;
  }

  function renderList(): void {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    const matches = (t: { tag: string }) => !q || t.tag.includes(q);
    const manual = groups.manual.filter(matches);
    const genres = groups.genres.filter(matches);
    entries = [];
    list.replaceChildren();
    const add = (tag: string, text: string, count?: number) => {
      const el = makeOption(tag, text, count);
      entries.push({ tag, el });
      list.append(el);
    };
    if (!q) add("", "All tags");
    // Group headings only help when both kinds exist.
    const both = manual.length > 0 && genres.length > 0;
    if (manual.length) {
      if (both) list.append(heading("Your tags"));
      for (const t of manual) add(t.tag, `#${t.tag}`, t.count);
    }
    if (genres.length) {
      if (both) list.append(heading("Genres"));
      for (const t of genres) add(t.tag, `#${t.tag}`, t.count);
    }
    if (entries.length === 0) {
      const li = document.createElement("li");
      li.className = "picker-empty";
      li.textContent = "No tags match";
      list.append(li);
    }
    setActive(Math.max(0, entries.findIndex((e) => e.tag === selected)), false);
  }

  function setActive(index: number, scroll: boolean): void {
    entries.forEach((e, i) => e.el.classList.toggle("active", i === index));
    active = index;
    const current = entries[index]?.el;
    const owner = search.hidden ? list : search;
    if (current) owner.setAttribute("aria-activedescendant", current.id);
    else owner.removeAttribute("aria-activedescendant");
    if (scroll) current?.scrollIntoView({ block: "nearest" });
  }

  function reposition(): void {
    const r = button.getBoundingClientRect();
    const width = Math.max(220, Math.round(r.width));
    const top = Math.round(r.bottom + 4);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(8, Math.min(Math.round(r.left), window.innerWidth - width - 8))}px`;
    panel.style.top = `${top}px`;
    // Never taller than the space under the button, so the list scrolls instead of leaving the popup.
    panel.style.maxHeight = `${Math.max(120, window.innerHeight - top - 8)}px`;
  }

  function show(): void {
    if (open) return;
    open = true;
    query = "";
    search.value = "";
    search.hidden = total() < SEARCH_FROM;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    renderList();
    reposition();
    (search.hidden ? list : search).focus();
    setActive(Math.max(0, entries.findIndex((e) => e.tag === selected)), true);
  }

  function hide(refocus: boolean): void {
    if (!open) return;
    open = false;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  }

  function choose(tag: string): void {
    hide(true);
    onSelect(tag);
  }

  button.addEventListener("click", () => (open ? hide(false) : show()));
  search.addEventListener("input", () => {
    query = search.value;
    renderList();
  });
  panel.addEventListener("keydown", (e) => {
    const last = entries.length - 1;
    if (e.key === "ArrowDown") setActive(Math.min(last, active + 1), true);
    else if (e.key === "ArrowUp") setActive(Math.max(0, active - 1), true);
    else if (e.key === "Home" && search.hidden) setActive(0, true);
    else if (e.key === "End" && search.hidden) setActive(last, true);
    else if (e.key === "Enter" && entries[active]) choose(entries[active].tag);
    else if (e.key === "Escape") hide(true);
    else if (e.key === "Tab") hide(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  // A press anywhere else, a scroll behind it, or a resize all close it.
  document.addEventListener("pointerdown", (e) => {
    if (open && !panel.contains(e.target as Node) && !button.contains(e.target as Node)) hide(false);
  }, true);
  window.addEventListener("resize", () => hide(false));
  document.getElementById("main")?.addEventListener("scroll", () => hide(false), { passive: true });

  return {
    setOptions(next, chosen) {
      groups = next;
      selected = chosen;
      labelEl.textContent = chosen ? `#${chosen}` : "All tags";
      if (open) {
        search.hidden = total() < SEARCH_FROM;
        renderList();
      }
    },
    close: () => hide(false),
    isOpen: () => open,
  };
}
