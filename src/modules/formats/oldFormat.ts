import { monthPattern, parseFullDate, toIsoDateInPeriod } from "../dateUtils.ts";
import { parseAmount } from "../parse.ts";
import type { ParsedStatement, Row } from "../parse.ts";

// Example of first row at the top of each transaction table
// TRANSACCIONES   DE 15 DIC 2025 A 14 ENE 2026 (31 DÍAS)   MONTOS EN PESOS MEXICANOS
const date = `\\d{2} (?:${monthPattern}) \\d{4}`;
const periodRegexp = new RegExp(`DE (${date}) A (${date})`);

// 15 DIC   Supermercado   Oxxo Oxxo Del Carmen   $174.00
// 03 DIC   Devolución   - $878.00 (no category)
const rowRegexp = new RegExp(
  `^(\\d{2}) (${monthPattern})\\s+(.+?)\\s+((?:- )?\\$[\\d,]+\\.\\d{2})$`,
);
const rowStartRegexp = new RegExp(`^\\d{2} (?:${monthPattern})\\s`);

// Delimiters for the beginning and end of the transactions tables
const tableStart = "TRANSACCIONES";
const saldoRegexp = /^Saldo final del periodo\s+(\$[\d,]+\.\d{2})$/;

// Limit increases aren't spending and don't move the balance
const ignoredMerchant = "Aumentaste tu límite";

export function readSaldoFinal(text: string) {
  for (const line of text.split("\n")) {
    const match = line.trim().match(saldoRegexp);
    if (match) return parseAmount(match[1]);
  }

  throw new Error("Could not find Saldo final del periodo");
}

export default function parse(text: string): ParsedStatement {
  const period = text.match(periodRegexp);
  if (!period) {
    throw new Error("Could not find the statement period (DE ... A ...)");
  }
  const periodStart = parseFullDate(period[1]);
  const periodEnd = parseFullDate(period[2]);

  // Only the lines between the table header and the final balance are
  // transactions. The installment table after it has row-like lines too.
  const lines = text.split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => line.startsWith(tableStart));
  const end = lines.findIndex((line) => saldoRegexp.test(line));
  if (start === -1 || end === -1) {
    throw new Error("Could not find the transactions table");
  }

  const rows: Row[] = [];
  const failed: string[] = [];
  const transactionsTable = lines.slice(start, end);

  for (const line of transactionsTable) {
    const match = line.match(rowRegexp);
    if (match) {
      const [, day, month, columns, amount] = match;
      // Columns are separated by 2+ spaces: category, merchant
      const parts = columns.split(/\s{2,}/);
      if (parts.length > 2) {
        failed.push(line);
        continue;
      }
      const [category, merchant] = parts.length === 2 ? parts : [null, parts[0]];
      if (merchant.startsWith(ignoredMerchant)) {
        continue;
      }
      rows.push({
        dateTransaction: toIsoDateInPeriod(day, month, periodStart, periodEnd),
        dateCharge: null,
        category,
        merchant,
        cents: parseAmount(amount),
      });
    } else if (rowStartRegexp.test(line)) {
      failed.push(line);
    }
  }

  return {
    rows,
    failed,
    expected: { kind: "old", saldoFinal: readSaldoFinal(text) },
  };
}
