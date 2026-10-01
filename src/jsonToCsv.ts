import fs from "node:fs/promises";
import path from "node:path";
import { toCsv } from "./modules/csv.ts";
import type {
  CategoryModel,
  CategoryPolicy,
} from "./modules/category/buildModel.ts";
import { decide } from "./modules/category/decide.ts";
import { deserializeModel } from "./modules/category/modelFile.ts";
import { toFireflyTable } from "./modules/firefly.ts";
import { isTransactionList } from "./modules/transaction.ts";

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

const policy = JSON.parse(
  await fs.readFile(path.join(process.cwd(), "category_policy.json"), "utf-8"),
) as CategoryPolicy;

// Built separately by buildCategoryModel.ts (npm run model), so every run
// classifies against the same model and its counts can be inspected.
const modelPath = path.join(process.cwd(), "model", "category_model.json");
let model: CategoryModel;
try {
  model = deserializeModel(await fs.readFile(modelPath, "utf-8"));
} catch (e) {
  console.error(`Error reading ${modelPath}! Run \`npm run model\` first.`);
  console.error(e);
  process.exit(1);
}

// The JSON on disk stays statement-faithful (null stays null) — categories
// are decided here, in memory, only for the CSV this run produces.
const categorized = json.map((transaction) => {
  return {
    ...transaction,
    category_name: decide(
      transaction.opposing_name,
      model,
      policy
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
