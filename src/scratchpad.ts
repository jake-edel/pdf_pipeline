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

const policyFile = "/home/jakobedel/Projects/pdf_pipeline/category_policy.json"
const categoryPolicy = JSON.parse(fs.readFileSync(policyFile).toString());
const model = buildModel(allTransactions, categoryPolicy)


const transactionsWithoutCategory = allTransactions.filter(transaction => {
  return transaction.category_name === null;
})


let count = 1;
for (const transaction of transactionsWithoutCategory) {
  const merchant = transaction.opposing_name
  const scores = classify(merchant, model);
  const [first, second, third] = scores;

  console.log(
    `\n${count}. ${merchant}\n` + 
    `${first.category}: ${first.score}\n` +
    `${second.category}: ${second.score}\n` +
    `${third.category}: ${third.score}\n`
  );

  count++;
}

process.exit(0);
