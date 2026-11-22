/** Appearance: follow the system, or always light or always dark. Kept in the popup's localStorage. */

export const THEME_KEY = "keepshelf.theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  system: "Automatic",
  light: "Light",
  dark: "Dark",
};

/** Anything stored that isn't a known choice means "follow the system". */
export function normalizeTheme(value: unknown): Theme {
  return (THEMES as readonly unknown[]).includes(value) ? (value as Theme) : "system";
}

export function readTheme(storage: Pick<Storage, "getItem"> | undefined): Theme {
  try {
    return normalizeTheme(storage?.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

/** The stylesheet reads `data-theme` on the root element; with none it follows the system. */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}
