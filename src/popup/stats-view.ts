import { computeStats, type ShelfStats } from "../shared/stats.js";
import type { MediaType, SavedItem } from "../shared/types.js";

export interface StatsHooks {
  showTooltip(text: string, anchor: HTMLElement): void;
  hideTooltip(): void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TYPE_NAMES: Record<MediaType, string> = {
  movie: "Movies",
  series: "Series",
  anime: "Anime",
  book: "Books",
  tab: "Tabs",
  link: "Links",
  note: "Notes",
};

interface Datum {
  label: string;
  value: number;
  /** Full text for the tooltip and table row. */
  detail: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A round axis maximum (1, 2, 5, 10, 20, 50 ...) so the top gridline reads cleanly. */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= max) return step * magnitude;
  }
  return max;
}

function tile(label: string, value: string): HTMLElement {
  const box = el("div", "stat-tile");
  box.append(el("span", "stat-tile-label", label), el("strong", "stat-tile-value", value));
  return box;
}

function section(title: string, subtitle?: string): HTMLElement {
  const wrap = el("section", "stats-card");
  wrap.append(el("h3", "stats-card-title", title));
  if (subtitle) wrap.append(el("p", "stats-card-sub", subtitle));
  return wrap;
}

function tableView(caption: string, data: Datum[]): HTMLElement {
  const details = el("details", "stats-table");
  details.append(el("summary", undefined, "View as table"));
  const table = el("table");
  table.createCaption().textContent = caption;
  for (const d of data) {
    const row = table.insertRow();
    row.insertCell().textContent = d.label;
    row.insertCell().textContent = String(d.value);
  }
  details.append(table);
  return details;
}

function attachHover(node: HTMLElement, text: string, hooks: StatsHooks): void {
  node.setAttribute("aria-label", text);
  node.tabIndex = 0;
  node.addEventListener("pointerenter", () => hooks.showTooltip(text, node));
  node.addEventListener("pointerleave", hooks.hideTooltip);
  node.addEventListener("focus", () => hooks.showTooltip(text, node));
  node.addEventListener("blur", hooks.hideTooltip);
}

function columnChart(data: Datum[], hooks: StatsHooks): HTMLElement {
  const max = Math.max(...data.map((d) => d.value), 0);
  const top = niceMax(max);
  const chart = el("div", "col-chart");
  chart.setAttribute("role", "img");

  const axis = el("div", "col-axis");
  axis.append(el("span", undefined, String(top)), el("span", undefined, "0"));

  const plot = el("div", "col-plot");
  const peak = data.findIndex((d) => d.value === max);
  data.forEach((d, i) => {
    const slot = el("div", "col-slot");
    attachHover(slot, d.detail, hooks);
    const bar = el("div", "col-bar");
    bar.style.height = `${(d.value / top) * 100}%`;
    bar.hidden = d.value === 0;
    slot.append(bar);
    // Only the peak is labelled directly; the axis and tooltip carry the rest.
    if (max > 0 && i === peak) {
      const value = el("span", "col-value", String(d.value));
      value.style.bottom = `${(d.value / top) * 100}%`;
      slot.append(value);
    }
    slot.append(el("span", "col-label", d.label));
    plot.append(slot);
  });

  chart.append(axis, plot);
  return chart;
}

function barList(data: Datum[], hooks: StatsHooks): HTMLElement {
  const max = Math.max(...data.map((d) => d.value), 1);
  const list = el("div", "bar-list");
  for (const d of data) {
    const row = el("div", "bar-row");
    attachHover(row, d.detail, hooks);
    const track = el("div", "bar-track");
    const bar = el("div", "bar-fill");
    bar.style.width = `${(d.value / max) * 100}%`;
    track.append(bar);
    row.append(el("span", "bar-label", d.label), track, el("span", "bar-value", String(d.value)));
    list.append(row);
  }
  return list;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function renderStats(container: HTMLElement, items: SavedItem[], hooks: StatsHooks, now = Date.now()): void {
  container.replaceChildren();
  const stats: ShelfStats = computeStats(items, now);

  if (stats.total === 0) {
    container.append(el("p", "settings-hint", "Nothing to show yet. Save a few things and your stats will appear here."));
    return;
  }

  const tiles = el("div", "stat-tiles");
  tiles.append(
    tile("Saved", String(stats.total)),
    tile("Finished", String(stats.byStatus.done)),
    tile("In progress", String(stats.byStatus.in_progress)),
    tile("Avg rating", stats.rating.average !== undefined ? `${stats.rating.average}/10` : "–")
  );
  container.append(tiles);

  const finished = stats.finishedPerMonth.map<Datum>(({ month, count }) => {
    const [year, m] = month.split("-");
    const name = `${MONTHS[Number(m) - 1]} ${year}`;
    return { label: MONTHS[Number(m) - 1], value: count, detail: `${name}: ${plural(count, "item")} finished` };
  });
  const totalFinished = finished.reduce((sum, d) => sum + d.value, 0);
  const monthly = section("Finished per month", `${plural(totalFinished, "item")} in the last 12 months`);
  monthly.append(columnChart(finished, hooks), tableView("Finished per month", finished));
  container.append(monthly);

  if (stats.rating.rated > 0) {
    const ratings = stats.rating.distribution.map<Datum>((count, i) => ({
      label: String(i + 1),
      value: count,
      detail: `${i + 1}/10: ${plural(count, "item")}`,
    }));
    const card = section("Your ratings", `${plural(stats.rating.rated, "rated item")}`);
    card.append(columnChart(ratings, hooks), tableView("Ratings", ratings));
    container.append(card);
  }

  const types = (Object.entries(stats.byType) as Array<[MediaType, number]>)
    .sort((a, b) => b[1] - a[1])
    .map<Datum>(([type, count]) => {
      const avg = stats.rating.byType[type];
      return {
        label: TYPE_NAMES[type],
        value: count,
        detail: `${TYPE_NAMES[type]}: ${count}${avg !== undefined ? `, avg rating ${avg}/10` : ""}`,
      };
    });
  const byType = section("By type");
  byType.append(barList(types, hooks));
  container.append(byType);

  if (stats.topGenres.length) {
    const genres = stats.topGenres.map<Datum>((g) => ({ label: g.name, value: g.count, detail: `${g.name}: ${g.count}` }));
    const card = section("Top genres");
    card.append(barList(genres, hooks));
    container.append(card);
  }

  if (stats.topTags.length) {
    const tags = stats.topTags.map<Datum>((t) => ({ label: `#${t.name}`, value: t.count, detail: `#${t.name}: ${t.count}` }));
    const card = section("Top tags");
    card.append(barList(tags, hooks));
    container.append(card);
  }

  if (stats.completionRate !== undefined) {
    container.append(el("p", "stats-footnote", `${stats.completionRate}% of your movies, series, anime and books are finished.`));
  }
}
