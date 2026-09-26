/**
 * Server-side period resolution for the prompt runbooks (issue #260).
 *
 * The prompts used to hand the model a relative phrase — "cette semaine",
 * "le mois en cours", "aujourd'hui (D) → D+H" — and let it work out the ISO
 * bounds. The server knows the date; the model regularly got a week boundary
 * or a month end wrong, and every mistake silently shifted the whole runbook.
 * Resolving here means the bounds are computed once, deterministically, and
 * appear in the runbook as literal `YYYY-MM-DD` values the model only copies.
 *
 * Dates are computed in the server's local calendar (the `Date` getters, not
 * UTC): a runbook is read by a person whose "today" is the server's day.
 */

export interface PeriodBounds {
  /** Inclusive first day, `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  endDate: string;
  /** First month covered, `YYYY-MM` (for the `startMonth` / `endMonth` filters). */
  startMonth: string;
  /** Last month covered, `YYYY-MM`. */
  endMonth: string;
  /** Human wording of what was resolved, for the runbook's first line. */
  label: string;
}

export type PeriodKind = "week" | "month";

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12,
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of a local date. */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM` of a local date. */
export function toIsoMonth(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** A new local date `days` after `d` (midnight, DST-safe through setDate). */
export function addDays(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

/** Monday of the ISO week containing `d`. */
function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(d, offset);
}

function weekBounds(monday: Date, label: string): PeriodBounds {
  const sunday = addDays(monday, 6);
  return {
    startDate: toIsoDate(monday),
    endDate: toIsoDate(sunday),
    startMonth: toIsoMonth(monday),
    endMonth: toIsoMonth(sunday),
    label,
  };
}

function monthBounds(year: number, month: number, label: string): PeriodBounds {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return {
    startDate: toIsoDate(first),
    endDate: toIsoDate(last),
    startMonth: toIsoMonth(first),
    endMonth: toIsoMonth(last),
    label,
  };
}

/** Monday of ISO week `week` of `year` (ISO 8601: week 1 contains January 4th). */
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  return addDays(mondayOf(jan4), (week - 1) * 7);
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Resolve a period argument to ISO bounds.
 *
 * Understood: nothing (→ the current `defaultKind`), "cette semaine" /
 * "semaine en cours" / "this week", "semaine dernière" / "la semaine passée",
 * "semaine prochaine", "ce mois" / "mois en cours" / "ce mois-ci", "mois
 * dernier", "mois prochain", `YYYY-MM`, `YYYY-Www` (ISO week), a French month
 * name with a year ("avril 2026"), and a `YYYY-MM-DD..YYYY-MM-DD` range.
 * Anything else returns `null`: the runbook then keeps the caller's wording
 * and tells the model today's date, so it still has an anchor.
 */
export function periodBounds(arg: string | undefined, now: Date, defaultKind: PeriodKind): PeriodBounds | null {
  const text = arg === undefined ? "" : normalize(arg);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (text === "") {
    return defaultKind === "week"
      ? weekBounds(mondayOf(today), "cette semaine")
      : monthBounds(today.getFullYear(), today.getMonth() + 1, "le mois en cours");
  }

  // Explicit range.
  const range = /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|->|→|a|au|-)\s*(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (range) {
    const first = range[1] ?? "";
    const second = range[2] ?? "";
    const a = first <= second ? first : second;
    const b = first <= second ? second : first;
    return { startDate: a, endDate: b, startMonth: a.slice(0, 7), endMonth: b.slice(0, 7), label: `du ${a} au ${b}` };
  }

  // ISO week: 2026-W14.
  const isoWeek = /^(\d{4})-?w(\d{1,2})$/.exec(text);
  if (isoWeek) {
    const year = Number(isoWeek[1]);
    const week = Number(isoWeek[2]);
    if (week >= 1 && week <= 53) return weekBounds(isoWeekMonday(year, week), `la semaine ${arg!.trim()}`);
  }

  // ISO month: 2026-04.
  const isoMonth = /^(\d{4})-(\d{2})$/.exec(text);
  if (isoMonth) {
    const month = Number(isoMonth[2]);
    if (month >= 1 && month <= 12) return monthBounds(Number(isoMonth[1]), month, `le mois ${text}`);
  }

  // French month name + year: "avril 2026".
  const named = /^([a-z]+)\s+(\d{4})$/.exec(text);
  const monthName = named?.[1];
  const monthIndex = monthName === undefined ? undefined : FRENCH_MONTHS[monthName];
  if (monthName !== undefined && monthIndex !== undefined) {
    const year = named?.[2] ?? "";
    return monthBounds(Number(year), monthIndex, `${monthName} ${year}`);
  }

  if (/^(cette semaine|semaine en cours|la semaine en cours|this week|semaine)$/.test(text)) {
    return weekBounds(mondayOf(today), "cette semaine");
  }
  if (/^(la )?semaine (derniere|passee|precedente)$/.test(text) || text === "last week") {
    return weekBounds(addDays(mondayOf(today), -7), "la semaine dernière");
  }
  if (/^(la )?semaine (prochaine|suivante)$/.test(text) || text === "next week") {
    return weekBounds(addDays(mondayOf(today), 7), "la semaine prochaine");
  }
  if (/^(ce mois([ -]ci)?|le mois en cours|mois en cours|this month|mois)$/.test(text)) {
    return monthBounds(today.getFullYear(), today.getMonth() + 1, "le mois en cours");
  }
  if (/^(le )?mois (dernier|passe|precedent)$/.test(text) || text === "last month") {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return monthBounds(d.getFullYear(), d.getMonth() + 1, "le mois dernier");
  }
  if (/^(le )?mois (prochain|suivant)$/.test(text) || text === "next month") {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return monthBounds(d.getFullYear(), d.getMonth() + 1, "le mois prochain");
  }

  return null;
}
