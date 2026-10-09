export type Row = {
  dateTransaction: string;
  /** Only the new format has a separate charge date */
  dateCharge: string | null;
  /** Only the old format has categories */
  category: string | null;
  merchant: string;
  /**
   * The actual person/company on the other end, when a format can tell them
   * apart from `merchant` (BBVA's SPEI rows print a counterparty name on
   * their own line; Nu never prints anything beyond the merchant string).
   * Falls back to `merchant` in toTransaction() when null.
   */
  counterparty: string | null;
  /**
   * Sign convention is per-format, not universal: Nu keeps charge-positive
   * (matching the printed statement, flipped for Firefly via amount_negated);
   * BBVA uses deposit-positive/withdrawal-negative (its natural balance
   * direction, no flip needed). See each format's own module.
   */
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
