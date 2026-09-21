const monthMap: { [index: string]: number } = {
  ENE: 0,
  FEB: 1,
  MAR: 2,
  ABR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AGO: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DIC: 11,
};

/** Regexp alternation of the month abbreviations, e.g. `ENE|FEB|...` */
export const monthPattern = Object.keys(monthMap).join("|");

/**
 * Builds a `YYYY-MM-DD` string. Goes through UTC so the result
 * doesn't depend on the machine's timezone.
 */
export function toIsoDate(year: number, day: number, month: string) {
  const monthIndex = monthMap[month];
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (
    monthIndex === undefined ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: ${day} ${month} ${year}`);
  }

  return date.toISOString().split("T")[0];
}

/** `15 JUL 2025` to ISO date */
export function parseFullDate(date: string) {
  const match = date.match(/^(\d{2}) (\w{3}) (\d{4})$/);
  if (!match) {
    throw new Error(`Date ${date} does not match RegExp pattern`);
  }
  const [, day, month, year] = match;

  return toIsoDate(Number.parseInt(year), Number.parseInt(day), month);
}

/**
 * `15 JUL` to ISO date, for statements whose rows carry no year.
 * The year is whichever one places the date inside the statement period,
 * which handles periods that span a year boundary.
 */
export function toIsoDateInPeriod(
  day: string,
  month: string,
  periodStart: string,
  periodEnd: string,
) {
  const years = new Set([periodStart, periodEnd].map((d) => Number(d.slice(0, 4))));
  for (const year of years) {
    const isoDate = toIsoDate(year, Number.parseInt(day), month);
    if (isoDate >= periodStart && isoDate <= periodEnd) {
      return isoDate;
    }
  }

  throw new Error(
    `Date ${day} ${month} is outside the statement period ${periodStart} to ${periodEnd}`,
  );
}
