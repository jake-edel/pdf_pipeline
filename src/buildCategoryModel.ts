import fs from "node:fs/promises";
import path from "node:path";
import { buildModel } from "./modules/category/buildModel.ts";
import type { CategoryPolicy } from "./modules/category/buildModel.ts";
import { serializeModel } from "./modules/category/modelFile.ts";
import { isTransactionList } from "./modules/transaction.ts";
import type { Transaction } from "./modules/transaction.ts";

// Category history for the classifier: every transaction we have, across
// every statement, categorized or not — buildModel() only keeps the rows
// that actually carry a bank-printed category. Files are read in sorted
// order so the model's Map insertion order doesn't depend on readdir().
const transactionsDir = path.join(process.cwd(), "transactions");
const history: Transaction[] = [];
for (const file of (await fs.readdir(transactionsDir)).sort()) {
  const data = JSON.parse(
    await fs.readFile(path.join(transactionsDir, file), "utf-8"),
  );
  if (isTransactionList(data)) history.push(...data);
}

const policy = JSON.parse(
  await fs.readFile(path.join(process.cwd(), "category_policy.json"), "utf-8"),
) as CategoryPolicy;

const model = buildModel(history, policy);

const modelDir = path.join(process.cwd(), "model");
await fs.mkdir(modelDir, { recursive: true });
const outfilePath = path.join(modelDir, "category_model.json");
try {
  await fs.writeFile(outfilePath, serializeModel(model));
} catch (e) {
  throw new Error(`Write to ${outfilePath} failed.`, { cause: e });
}

console.log(
  `${outfilePath}: ${model.categoryTransactionCounts.size} categories, ` +
    `${model.vocabularySize} words`,
);
