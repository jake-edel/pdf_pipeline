import { monthPattern, parseFullDate } from "../dateUtils.ts";
import { parseAmount } from "../parse.ts";
import type { Row } from "../parse.ts";
import type { Format, ParsedStatement } from "./types.ts";

// 28 ENE 2026 15 MAR 2026 Qualitas Sel - 3/6 | RFC: S.I. +$1,195.69
// Requiring both dates keeps the one-date installment table out.
const date = `\\d{2} (?:${monthPattern}) \\d{4}`;
const rowRegexp = new RegExp(
  `^(${date}) (${date}) (.+?) \\| RFC: \\S+ ([+-]\\$[\\d,]+\\.\\d{2})$`,
);
const rowStartRegexp = new RegExp(`^${date} ${date} `);

type NuNewParsedStatement = ParsedStatement & { charges: number; credits: number };

function parse(text: string): NuNewParsedStatement {
  const lines = text.split("\n").map((line) => line.trim());

  const rows: Row[] = [];
  const failed: string[] = [];
  for (const line of lines) {
    const match = line.match(rowRegexp);
    if (match) {
      const [, dateTransaction, dateCharge, merchant, amount] = match;
      rows.push({
        dateTransaction: parseFullDate(dateTransaction),
        dateCharge: parseFullDate(dateCharge),
        category: null,
        merchant,
        cents: parseAmount(amount),
      });
    } else if (rowStartRegexp.test(line)) {
      failed.push(line);
    }
  }

  // The printed totals precede their labels:
  // +$20,102.72 / -$21,230.56 / Total de cargos / Total de abonos
  const totalsIndex = lines.indexOf("Total de cargos");
  if (totalsIndex < 2 || lines[totalsIndex + 1] !== "Total de abonos") {
    throw new Error("Could not find the Total de cargos / Total de abonos lines");
  }

  return {
    rows,
    failed,
    charges: parseAmount(lines[totalsIndex - 2]),
    credits: parseAmount(lines[totalsIndex - 1]),
  };
}

const dollars = (cents: number) => (cents / 100).toFixed(2);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** New format prints its own totals, so reconciliation needs no other statement. */
function reconcile(parsed: NuNewParsedStatement) {
  const errors: string[] = [];
  const cents = parsed.rows.map((row) => row.cents);
  const charges = sum(cents.filter((c) => c > 0));
  const credits = sum(cents.filter((c) => c < 0));

  if (charges !== parsed.charges) {
    errors.push(
      `Total de cargos: rows sum to ${dollars(charges)}, statement says ${dollars(parsed.charges)}`,
    );
  }
  if (credits !== parsed.credits) {
    errors.push(
      `Total de abonos: rows sum to ${dollars(credits)}, statement says ${dollars(parsed.credits)}`,
    );
  }

  return errors;
}

/**
 * Same test as src/extractPdfText.ts: only the new statements
 * have `Página N de M` page headers.
 */
const detect = (text: string) => /^Página \d+ de \d+/m.test(text);

const nuNewFormat: Format<NuNewParsedStatement> = {
  id: "nu-new",
  detect,
  parse,
  needsPreviousStatement: false,
  reconcile,
};

export default nuNewFormat;
