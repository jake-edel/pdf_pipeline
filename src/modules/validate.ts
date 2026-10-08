import type { ParsedStatement } from "./formats/types.ts";

/**
 * Checks that apply to every format, regardless of how it reconciles
 * amounts. Format-specific checks (totals, saldo) live in each format's
 * own `reconcile()`.
 * @returns - a list of problems, empty if everything checks out
 */
export default function validate({ rows, failed }: ParsedStatement) {
  const errors: string[] = [];

  if (rows.length === 0) {
    errors.push("No transactions found");
  }
  if (failed.length > 0) {
    errors.push(`${failed.length} row-like line(s) failed to parse`);
  }

  return errors;
}
