import fs from "node:fs/promises";
import path from "node:path";
import { toCsv } from "./modules/csv.ts";
import { buildModel } from "./modules/category/buildModel.ts";
import type { CategoryPolicy } from "./modules/category/buildModel.ts";
import { decide } from "./modules/category/decide.ts";
import { toFireflyTable } from "./modules/firefly.ts";
import { isTransactionList } from "./modules/transaction.ts";
import type { Transaction } from "./modules/transaction.ts";

// Provisional — not yet tuned against real Undecided output. See the "left
// open" list in notes/category-engine-design.md.
const CATEGORY_CONFIDENCE_THRESHOLD = 0.5;

if (process.argv.length < 3) {
  console.log("No filename argument provided!");
  process.exit(1);
}

const filename = process.argv[2];

let json: unknown;
try {
  json = JSON.parse(await fs.readFile(filename, "utf-8"));
} catch {
  console.error("Error reading JSON file!");
  process.exit(1);
}
if (!isTransactionList(json)) {
  console.error("File is not a list of transactions!");
  process.exit(1);
}

// Category history for the classifier: every transaction we have, across
// every statement, categorized or not — buildModel() only keeps the rows
// that actually carry a bank-printed category.
const transactionsDir = path.join(process.cwd(), "transactions");
const history: Transaction[] = [];
for (const file of await fs.readdir(transactionsDir)) {
  const data = JSON.parse(
    await fs.readFile(path.join(transactionsDir, file), "utf-8"),
  );
  if (isTransactionList(data)) history.push(...data);
}

const policy = JSON.parse(
  await fs.readFile(path.join(process.cwd(), "category_policy.json"), "utf-8"),
) as CategoryPolicy;

const model = buildModel(history, policy);

// The JSON on disk stays statement-faithful (null stays null) — categories
// are decided here, in memory, only for the CSV this run produces.
const categorized = json.map((transaction) => {
  return {
    ...transaction,
    category_name: decide(
      transaction.opposing_name,
      model,
      policy,
      CATEGORY_CONFIDENCE_THRESHOLD,
    ),
  };
});

const statement = path.basename(filename, ".json");
const { table, skipped } = toFireflyTable(statement, categorized);
const undecided = categorized.filter((t) => t.category_name === null).length;

const csvDir = path.join(process.cwd(), "/csv");
await fs.mkdir(csvDir, { recursive: true });
const outfilePath = path.join(csvDir, statement) + ".csv";
try {
  await fs.writeFile(outfilePath, toCsv(table));
} catch (e) {
  throw new Error(`Write to ${outfilePath} failed.`, { cause: e });
}

console.log(
  `${statement}: ${table.length - 1} rows, skipped ${skipped} payment row(s), ` +
    `${undecided} Undecided`,
);
