import fs from "node:fs/promises";
import path from "node:path";
import { buildModel } from "./modules/category/buildModel.ts";
import type { CategoryPolicy } from "./modules/category/buildModel.ts";
import { decide } from "./modules/category/decide.ts";
import { deserializeModel, serializeModel } from "./modules/category/modelFile.ts";
import { isTransactionList } from "./modules/transaction.ts";
import type { Transaction } from "./modules/transaction.ts";

// Self-training: use the base model (ground truth only — bank-printed
// categories and exact policy matches, built by buildCategoryModel.ts) to
// fill in a category guess for every transaction it left `category_name:
// null`. The merged result becomes the training set for a second,
// "enriched" model. Bootstrapping always starts from the base model, never
// from a previous enriched one, so pseudo-label errors can't compound
// across runs.
const modelDir = path.join(process.cwd(), "model");
const basePath = path.join(modelDir, "category_model.json");

let baseModel;
try {
  baseModel = deserializeModel(await fs.readFile(basePath, "utf-8"));
} catch (e) {
  console.error(`Error reading ${basePath}! Run \`npm run model\` first.`);
  console.error(e);
  process.exit(1);
}

const policy = JSON.parse(
  await fs.readFile(path.join(process.cwd(), "category_policy.json"), "utf-8"),
) as CategoryPolicy;

const transactionsDir = path.join(process.cwd(), "transactions");
const history: Transaction[] = [];

const files = (await fs.readdir(transactionsDir, { recursive: true }))
  .filter((file) => file.endsWith(".json"))
  .sort();
for (const file of files) {
  const data = JSON.parse(
    await fs.readFile(path.join(transactionsDir, file), "utf-8"),
  );
  if (isTransactionList(data)) history.push(...data);
}

let pseudoLabeled = 0;
const enriched: Transaction[] = history.map((transaction) => {
  if (transaction.category_name !== null) return transaction;

  const category = decide(transaction.opposing_name, baseModel, policy);
  if (category === null) return transaction;

  pseudoLabeled++;
  return { ...transaction, category_name: category };
});

const trainingHistoryPath = path.join(modelDir, "training_history.json");
await fs.writeFile(
  trainingHistoryPath,
  JSON.stringify(enriched, null, 2) + "\n",
);

const enrichedModel = buildModel(enriched, policy);
const enrichedModelPath = path.join(modelDir, "category_model_enriched.json");
await fs.mkdir(modelDir, { recursive: true });
try {
  await fs.writeFile(enrichedModelPath, serializeModel(enrichedModel));
} catch (e) {
  throw new Error(`Write to ${enrichedModelPath} failed.`, { cause: e });
}

console.log(
  `${trainingHistoryPath}: ${pseudoLabeled} row(s) pseudo-labeled`,
);
console.log(
  `${enrichedModelPath}: ${enrichedModel.categoryTransactionCounts.size} categories, ` +
    `${enrichedModel.vocabularySize} words`,
);
