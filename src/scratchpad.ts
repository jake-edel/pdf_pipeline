import fs from "node:fs";
import process from "node:process";
import readline from "node:readline/promises";
import { buildModel } from "./modules/category/buildModel.ts";
import type { Transaction } from "./modules/transaction.ts";
import { classify } from "./modules/category/classify.ts";

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

const policyFile = "/home/jakobedel/Projects/pdf_pipeline/category_policy.sample.json"
const categoryPolicy = JSON.parse(fs.readFileSync(policyFile).toString());
const model = buildModel(allTransactions, categoryPolicy)


const transactionsWithoutCategory = allTransactions.filter(transaction => {
  return transaction.category_name === null;
})

// const rl = readline.createInterface({ input: process.stdin });
let count = 1;
for (const transaction of transactionsWithoutCategory) {
  const merchant = transaction.opposing_name
  const scores = classify(merchant, model);
  console.log(`${count}. ${merchant}: ${scores[0].category}`);
  // await rl.question("");
  count++;
}

process.exit(0);
