import fs from "node:fs/promises";
import path from "node:path";
import { toCsv } from "./modules/csv.ts";
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

const statement = path.basename(filename, ".json");
const { table, skipped } = toFireflyTable(statement, json);

const csvDir = path.join(process.cwd(), "/csv");
await fs.mkdir(csvDir, { recursive: true });
const outfilePath = path.join(csvDir, statement) + ".csv";
try {
  await fs.writeFile(outfilePath, toCsv(table));
} catch (e) {
  throw new Error(`Write to ${outfilePath} failed.`, { cause: e });
}

console.log(`${statement}: ${table.length - 1} rows, skipped ${skipped} payment row(s)`);
