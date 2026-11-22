// Loaded in <head> before the stylesheet paints, so a chosen theme shows from the first frame with no flash.
import { applyTheme, readTheme } from "../shared/theme.js";

applyTheme(document.documentElement, readTheme(window.localStorage));
