import fs from "node:fs";
import { tokenize } from "./modules/category/tokenize.ts";
import type { Transaction } from "./modules/transaction.ts";

const allTransactions: Transaction[] = [];
const transactionsDir = "./transactions";
const files = fs.readdirSync(transactionsDir);

for (const file of files) {
  const data = fs.readFileSync(`${transactionsDir}/${file}`).toString();
  const transactions = JSON.parse(data) as Transaction[];

  for (const transaction of transactions) {
    allTransactions.push(transaction);
  }
}

const tokens = new Set();
for (const transaction of allTransactions) {
  for (const token of tokenize(transaction.opposing_name)) {
    tokens.add(token);
  }
}

console.log(tokens);
