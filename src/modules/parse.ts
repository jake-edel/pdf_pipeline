/** One transaction, as read from the statement. Amounts are integer cents. */
export type Row = {
  dateTransaction: string;
  /** Only the new format has a separate charge date */
  dateCharge: string | null;
  /** Only the old format has categories */
  category: string | null;
  merchant: string;
  /** Charges are positive, payments and credits are negative */
  cents: number;
};

/** What the statement itself prints, for cross-checking the parsed rows */
export type Expected =
  | { kind: "new"; charges: number; credits: number }
  | { kind: "old"; saldoFinal: number };

export type ParsedStatement = {
  rows: Row[];
  /** Lines that look like a row but didn't parse */
  failed: string[];
  expected: Expected;
};

/** `+$1,195.69`, `-$21,230.56`, `- $4,300.00` or `$6,038.06` to integer cents */
export function parseAmount(amount: string) {
  const match = amount.match(/^([+-])?\s?\$([\d,]+)\.(\d{2})$/);
  if (!match) {
    throw new Error(`Amount ${amount} does not match RegExp pattern`);
  }
  const [, sign, whole, fraction] = match;
  const cents =
    Number.parseInt(whole.replaceAll(",", "")) * 100 + Number.parseInt(fraction);

  return sign === "-" ? -cents : cents;
}
