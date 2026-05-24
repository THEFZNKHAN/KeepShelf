const TOAST_ID = "keepshelf-toast";
const STYLE_ID = "keepshelf-ui-styles";

const UI_FONT_LINK =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";

export type ToastVariant = "success" | "error" | "info";

export interface ToastContent {
  title: string;
  subtitle?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

function ensureToastStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = UI_FONT_LINK;
  document.head.appendChild(link);

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${TOAST_ID} {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      width: 300px;
      max-width: calc(100vw - 48px);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border: 1px solid #c4c7c7;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      font-family: Inter, system-ui, sans-serif;
      opacity: 0;
      transform: translateY(16px);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    #${TOAST_ID}.visible {
      opacity: 1;
      transform: translateY(0);
    }
    #${TOAST_ID} .keepshelf-toast-icon {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #${TOAST_ID} .keepshelf-toast-icon .material-symbols-outlined {
      font-size: 16px;
      font-variation-settings: "FILL" 1;
    }
    #${TOAST_ID}[data-variant="success"] .keepshelf-toast-icon {
      background: #e8f5e9;
      color: #2e7d32;
    }
    #${TOAST_ID}[data-variant="error"] .keepshelf-toast-icon {
      background: #ffdad6;
      color: #ba1a1a;
    }
    #${TOAST_ID}[data-variant="info"] .keepshelf-toast-icon {
      background: #e8e8e8;
      color: #444748;
    }
    #${TOAST_ID} .keepshelf-toast-body {
      flex: 1;
      min-width: 0;
    }
    #${TOAST_ID} .keepshelf-toast-title {
      margin: 0;
      font-size: 13px;
      line-height: 18px;
      color: #1a1c1c;
    }
    #${TOAST_ID} .keepshelf-toast-subtitle {
      margin: 0;
      font-size: 11px;
      line-height: 14px;
      font-weight: 600;
      color: #444748;
    }
    #${TOAST_ID} .keepshelf-toast-close {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: #444748;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    #${TOAST_ID} .keepshelf-toast-close:hover {
      background: #eeeeee;
    }
    #${TOAST_ID} .keepshelf-toast-close .material-symbols-outlined {
      font-size: 18px;
      font-variation-settings: "FILL" 0;
    }
  `;
  document.head.appendChild(style);
}

export function showToast(
  content: string | ToastContent,
  variant?: ToastVariant
): void {
  ensureToastStyles();

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
