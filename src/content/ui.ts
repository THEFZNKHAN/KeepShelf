import type { ParsedMedia } from "../shared/types.js";

const BUTTON_ID = "keepshelf-save-btn";
const TOAST_ID = "keepshelf-toast";
const STYLE_ID = "keepshelf-ui-styles";

const UI_FONT_LINK =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Space+Mono:ital,wght@0,400;0,700&family=Syne:wght@400..800&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";

export type ToastVariant = "success" | "error" | "info";

export interface ToastContent {
  title: string;
  subtitle?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

function ensureUiStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = UI_FONT_LINK;
  document.head.appendChild(link);

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483646;
      width: 52px;
      height: 52px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 4px solid #000000;
      border-radius: 999px;
      background: #c3f400;
      color: #000000;
      cursor: pointer;
      box-shadow: 4px 4px 0 0 #000000;
      transition: transform 0.1s ease, box-shadow 0.1s ease;
      font-family: "Space Mono", monospace;
    }
    #${BUTTON_ID}:hover {
      transform: translate(-2px, -2px);
      box-shadow: 6px 6px 0 0 #000000;
    }
    #${BUTTON_ID}:active {
      transform: translate(2px, 2px);
      box-shadow: 2px 2px 0 0 #000000;
    }
    #${BUTTON_ID} .material-symbols-outlined {
      font-size: 24px;
      font-variation-settings: "FILL" 1;
    }
    #${TOAST_ID} {
      position: fixed;
      bottom: 88px;
      right: 24px;
      z-index: 2147483647;
      width: 320px;
      max-width: calc(100vw - 48px);
      padding: 14px 12px;
      border: 4px solid #000000;
      border-radius: 4px;
      background: #201f1f;
      box-shadow: 4px 4px 0 0 #000000;
      font-family: "Bricolage Grotesque", system-ui, sans-serif;
      opacity: 0;
      transform: translateY(16px);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    #${TOAST_ID}.visible {
      opacity: 1;
      transform: translateY(0);
    }
    #${TOAST_ID} .keepshelf-toast-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    #${TOAST_ID} .keepshelf-toast-icon {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border: 2px solid #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 2px 2px 0 0 #000000;
    }
    #${TOAST_ID} .keepshelf-toast-icon .material-symbols-outlined {
      font-size: 18px;
      font-variation-settings: "FILL" 1;
    }
    #${TOAST_ID}[data-variant="success"] .keepshelf-toast-icon {
      background: #c3f400;
      color: #556d00;
    }
    #${TOAST_ID}[data-variant="error"] .keepshelf-toast-icon {
      background: #93000a;
      color: #ffb4ab;
    }
    #${TOAST_ID}[data-variant="info"] .keepshelf-toast-icon {
      background: #fe00fe;
      color: #500050;
    }
    #${TOAST_ID} .keepshelf-toast-body {
      flex: 1;
      min-width: 0;
    }
    #${TOAST_ID} .keepshelf-toast-title {
      margin: 0;
      font-family: Syne, sans-serif;
      font-size: 14px;
      font-weight: 800;
      line-height: 1.2;
      text-transform: uppercase;
      color: #ffffff;
    }
    #${TOAST_ID} .keepshelf-toast-subtitle {
      margin: 4px 0 0;
      font-family: "Space Mono", monospace;
      font-size: 10px;
      line-height: 1.3;
      font-weight: 700;
      color: #c4c9ac;
    }
    #${TOAST_ID} .keepshelf-toast-close {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border: 2px solid #000000;
      background: #353534;
      color: #e5e2e1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      box-shadow: 2px 2px 0 0 #000000;
    }
    #${TOAST_ID} .keepshelf-toast-close:active {
      transform: translate(1px, 1px);
      box-shadow: 1px 1px 0 0 #000000;
    }
    #${TOAST_ID} .keepshelf-toast-close .material-symbols-outlined {
      font-size: 16px;
      font-variation-settings: "FILL" 0;
    }
  `;
  document.head.appendChild(style);
}

export function removeSaveButton(): void {
  document.getElementById(BUTTON_ID)?.remove();
}

export function showSaveButton(onSave: () => void): void {
  ensureUiStyles();

  let btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.setAttribute("aria-label", "Save to KeepShelf");
    btn.title = "Save to KeepShelf";
    btn.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true">bookmark</span>';
    document.body.appendChild(btn);
  }
  btn.onclick = onSave;
  btn.style.display = "flex";
}

export function showToast(
  content: string | ToastContent,
  variant?: ToastVariant
): void {
  ensureUiStyles();

  const options: ToastContent =
    typeof content === "string"
      ? { title: content, variant: variant ?? "info" }
      : content;
  const toastVariant = options.variant ?? "info";

  let toast = document.getElementById(TOAST_ID) as
    | (HTMLElement & { _ksTimer?: number })
    | null;

  if (!toast) {
    toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.innerHTML = `
      <div class="keepshelf-toast-row">
        <div class="keepshelf-toast-icon">
          <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
        </div>
        <div class="keepshelf-toast-body">
          <p class="keepshelf-toast-title"></p>
          <p class="keepshelf-toast-subtitle" hidden></p>
        </div>
        <button type="button" class="keepshelf-toast-close" aria-label="Dismiss">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    `;
    toast
      .querySelector(".keepshelf-toast-close")
      ?.addEventListener("click", () => hideToast(toast!));
    document.body.appendChild(toast);
  }

  toast.dataset.variant = toastVariant;

  const icon = toast.querySelector(
    ".keepshelf-toast-icon .material-symbols-outlined"
  );
  if (icon) {
    icon.textContent =
      toastVariant === "error"
        ? "error"
        : toastVariant === "info"
          ? "info"
          : "check_circle";
  }

  const titleEl = toast.querySelector(".keepshelf-toast-title");
  const subtitleEl = toast.querySelector(
    ".keepshelf-toast-subtitle"
  ) as HTMLElement | null;

  if (titleEl) {
    titleEl.textContent = options.title;
  }

  if (subtitleEl) {
    if (options.subtitle) {
      subtitleEl.textContent = options.subtitle;
      subtitleEl.hidden = false;
    } else {
      subtitleEl.textContent = "";
      subtitleEl.hidden = true;
    }
  }

  toast.classList.add("visible");

  clearTimeout(toast._ksTimer);
  toast._ksTimer = window.setTimeout(() => {
    hideToast(toast!);
  }, options.durationMs ?? 4000);
}

function hideToast(toast: HTMLElement): void {
  toast.classList.remove("visible");
}

export function previewLabel(parsed: ParsedMedia): string {
  const year = parsed.year ? ` (${parsed.year})` : "";
  return `${parsed.title}${year}`;
}
