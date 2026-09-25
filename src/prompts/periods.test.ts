import { describe, it, expect } from "vitest";
import { addDays, periodBounds, toIsoDate, toIsoMonth } from "./periods.js";

// A Wednesday: 2026-09-23. Its ISO week is Mon 2026-09-21 → Sun 2026-09-27.
const WED = new Date(2026, 8, 23, 15, 30);

describe("periodBounds (#260)", () => {
  it("defaults to the current ISO week or month", () => {
    expect(periodBounds(undefined, WED, "week")).toMatchObject({
      startDate: "2026-09-21",
      endDate: "2026-09-27",
      startMonth: "2026-09",
      endMonth: "2026-09",
      label: "cette semaine",
    });
    expect(periodBounds("", WED, "month")).toMatchObject({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      label: "le mois en cours",
    });
  });

  it("starts the week on Monday even when today is Sunday or Monday", () => {
    const sunday = new Date(2026, 8, 27);
    expect(periodBounds("cette semaine", sunday, "week")).toMatchObject({
      startDate: "2026-09-21",
      endDate: "2026-09-27",
    });
    const monday = new Date(2026, 8, 21);
    expect(periodBounds("cette semaine", monday, "week")).toMatchObject({
      startDate: "2026-09-21",
      endDate: "2026-09-27",
    });
  });

  it("resolves last / next week, crossing a month and a year boundary", () => {
    expect(periodBounds("la semaine dernière", WED, "week")).toMatchObject({
      startDate: "2026-09-14",
      endDate: "2026-09-20",
    });
    expect(periodBounds("semaine prochaine", WED, "week")).toMatchObject({
      startDate: "2026-09-28",
      endDate: "2026-10-04",
      startMonth: "2026-09",
      endMonth: "2026-10",
    });
    // Thu 2026-12-31 → its week runs into 2027.
    const nye = new Date(2026, 11, 31);
    expect(periodBounds("cette semaine", nye, "week")).toMatchObject({
      startDate: "2026-12-28",
      endDate: "2027-01-03",
      startMonth: "2026-12",
      endMonth: "2027-01",
    });
    expect(periodBounds("semaine prochaine", nye, "week")).toMatchObject({
      startDate: "2027-01-04",
      endDate: "2027-01-10",
    });
  });

  it("resolves this / last / next month, including across a year boundary", () => {
    const jan = new Date(2027, 0, 15);
    expect(periodBounds("ce mois-ci", jan, "month")).toMatchObject({ startDate: "2027-01-01", endDate: "2027-01-31" });
    expect(periodBounds("mois dernier", jan, "month")).toMatchObject({
      startDate: "2026-12-01",
      endDate: "2026-12-31",
    });
    expect(periodBounds("le mois prochain", jan, "month")).toMatchObject({
      startDate: "2027-02-01",
      endDate: "2027-02-28",
    });
    // Leap year end-of-month.
    expect(periodBounds("2028-02", WED, "month")).toMatchObject({ startDate: "2028-02-01", endDate: "2028-02-29" });
  });

  it("understands YYYY-MM, a French month name, an ISO week and an explicit range", () => {
    expect(periodBounds("2026-04", WED, "week")).toMatchObject({ startDate: "2026-04-01", endDate: "2026-04-30" });
    expect(periodBounds("Avril 2026", WED, "week")).toMatchObject({ startDate: "2026-04-01", endDate: "2026-04-30" });
    expect(periodBounds("février 2026", WED, "week")).toMatchObject({ startDate: "2026-02-01", endDate: "2026-02-28" });
    // ISO week 1 of 2027 contains January 4th 2027 (a Monday).
    expect(periodBounds("2027-W01", WED, "month")).toMatchObject({ startDate: "2027-01-04", endDate: "2027-01-10" });
    expect(periodBounds("2026-W14", WED, "month")).toMatchObject({ startDate: "2026-03-30", endDate: "2026-04-05" });
    expect(periodBounds("2026-09-10..2026-09-12", WED, "week")).toMatchObject({
      startDate: "2026-09-10",
      endDate: "2026-09-12",
      label: "du 2026-09-10 au 2026-09-12",
    });
  });

  it("returns null on wording it does not understand, so the runbook keeps the caller's words", () => {
    expect(periodBounds("depuis la rentrée", WED, "week")).toBeNull();
    expect(periodBounds("2026-13", WED, "week")).toBeNull();
    expect(periodBounds("2026-W60", WED, "week")).toBeNull();
  });

  it("date helpers are local-calendar based", () => {
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(toIsoMonth(new Date(2026, 11, 31))).toBe("2026-12");
    expect(toIsoDate(addDays(new Date(2026, 1, 28), 1))).toBe("2026-03-01");
    expect(toIsoDate(addDays(new Date(2026, 0, 1), -1))).toBe("2025-12-31");
  });
});
