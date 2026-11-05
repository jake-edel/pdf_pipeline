import { createHash } from "node:crypto";
import type { Transaction } from "./transaction.ts";

// Card payments are transfers from the bank account. That account is imported
// into Firefly too, so the transfer is created from that side.
const cardPaymentRegexp = /^(Pago a tu tarjeta de crédito|¡Gr[aá]cias por tu pago!)$/;

export const isCardPayment = (transaction: Transaction) =>
  transaction.amount < 0 && cardPaymentRegexp.test(transaction.opposing_name);

// Look for self transfers to Nu Bank. Route them to the savings
// or credit card account using the value in the memo
const nuTransferRegexp = /^SPEI (ENVIADO|RECIBIDO) ?(NU MEXICO|NUBANK)$/;
const ownNameRegexp = /^Jakob Andrew Edelstein\b(?: \((.*)\))?/i;

const opposingName = (transaction: Transaction) => {
  const own = ownNameRegexp.exec(transaction.opposing_name);
  if (!nuTransferRegexp.test(transaction.description) || !own) {
    return transaction.opposing_name;
  }
  return own[1] === "credito" ? "Tarjeta Nu" : "Nu Bank";
};

/**
 * One id per transaction, so the importer can tell apart rows that are
 * identical on date, merchant and amount. The date is left out on purpose,
 * so changing which date is used doesn't change the ids.
 */
function externalIds(statement: string, transactions: Transaction[]) {
  const seen = new Map<string, number>();

  return transactions.map(({ opposing_name, amount }) => {
    const key = `${opposing_name}|${Math.round(amount * 100)}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const hash = createHash("sha1")
      .update(`${statement}|${key}|${occurrence}`)
      .digest("hex")
      .slice(0, 12);

    return `${statement}-${hash}`;
  });
}

// The header of each column is the Data Importer role it gets assigned in the
// importer's config, in this order. Amounts keep the statement's sign
// (charge +, payment -), which the amount_negated role flips.
const columns: {
  header: string;
  value: (transaction: Transaction, externalId: string) => string;
}[] = [
  { header: "date_transaction", value: (t) => t.date_transaction },
  { header: "description", value: (t) => t.description },
  { header: "amount_negated", value: (t) => t.amount.toFixed(2) },
  { header: "opposing-name", value: opposingName },
  { header: "category-name", value: (t) => t.category_name ?? "Undecided" },
  { header: "external-id", value: (_, externalId) => externalId },
];

/** Header row plus one row per transaction, card payments left out */
export function toFireflyTable(statement: string, transactions: Transaction[]) {
  const charges = transactions.filter((t) => !isCardPayment(t));
  const ids = externalIds(statement, charges);

  return {
    table: [
      columns.map((column) => column.header),
      ...charges.map((t, i) => columns.map((column) => column.value(t, ids[i]))),
    ],
    skipped: transactions.length - charges.length,
  };
}
