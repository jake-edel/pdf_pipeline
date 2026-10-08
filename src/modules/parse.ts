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
