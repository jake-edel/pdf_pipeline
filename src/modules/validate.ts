import type { ParsedStatement } from "./parse.ts";

const dollars = (cents: number) => (cents / 100).toFixed(2);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * Cross-checks the parsed rows against what the statement prints.
 * @param previousSaldoFinal - final balance of the previous statement, if known.
 * Only used by the old format, which has no totals of its own.
 * @returns - a list of problems, empty if everything checks out
 */
export default function validate(
  { rows, failed, expected }: ParsedStatement,
  previousSaldoFinal: number | null,
) {
  const errors: string[] = [];

  if (rows.length === 0) {
    errors.push("No transactions found");
  }
  if (failed.length > 0) {
    errors.push(`${failed.length} row-like line(s) failed to parse`);
  }

  const cents = rows.map((row) => row.cents);
  if (expected.kind === "new") {
    const charges = sum(cents.filter((c) => c > 0));
    const credits = sum(cents.filter((c) => c < 0));
    if (charges !== expected.charges) {
      errors.push(
        `Total de cargos: rows sum to ${dollars(charges)}, statement says ${dollars(expected.charges)}`,
      );
    }
    if (credits !== expected.credits) {
      errors.push(
        `Total de abonos: rows sum to ${dollars(credits)}, statement says ${dollars(expected.credits)}`,
      );
    }
  } else if (previousSaldoFinal !== null) {
    const opening = expected.saldoFinal - sum(cents);
    if (opening !== previousSaldoFinal) {
      errors.push(
        `Implied opening balance ${dollars(opening)} differs from the previous statement's final balance ${dollars(previousSaldoFinal)}`,
      );
    }
  }

  return errors;
}
