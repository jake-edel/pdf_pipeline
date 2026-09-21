import { monthPattern, parseFullDate } from "../dateUtils.ts";
import { parseAmount } from "../parse.ts";
import type { ParsedStatement, Row } from "../parse.ts";

// 28 ENE 2026 15 MAR 2026 Qualitas Sel - 3/6 | RFC: S.I. +$1,195.69
// Requiring both dates keeps the one-date installment table out.
const date = `\\d{2} (?:${monthPattern}) \\d{4}`;
const rowRegexp = new RegExp(
  `^(${date}) (${date}) (.+?) \\| RFC: \\S+ ([+-]\\$[\\d,]+\\.\\d{2})$`,
);
const rowStartRegexp = new RegExp(`^${date} ${date} `);

export default function parse(text: string): ParsedStatement {
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
    expected: {
      kind: "new",
      charges: parseAmount(lines[totalsIndex - 2]),
      credits: parseAmount(lines[totalsIndex - 1]),
    },
  };
}
