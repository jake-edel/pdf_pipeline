import type { Row } from "./parse.ts";

/**
 * One entry of transactions/<name>.json, the contract between the text-to-JSON
 * stage and whatever reads the JSON. Charges are positive, payments and credits
 * are negative.
 */
export type Transaction = {
  date_transaction: string;
  category_name: string | null;
  opposing_name: string;
  description: string;
  amount: number;
};

/** For stages that read the JSON back in */
export function isTransactionList(value: unknown): value is Transaction[] {
  return (
    Array.isArray(value) &&
    value.every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof t.date_transaction === "string" &&
        (typeof t.category_name === "string" || t.category_name === null) &&
        typeof t.opposing_name === "string" &&
        typeof t.description === "string" &&
        typeof t.amount === "number",
    )
  );
}

export function toTransaction(row: Row): Transaction {
  return {
    date_transaction: row.dateTransaction,
    category_name: row.category,
    opposing_name: row.merchant,
    description: row.merchant,
    amount: row.cents / 100,
  };
}
