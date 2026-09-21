import fs from "node:fs/promises";
import path from "node:path";
import detectFormat from "./modules/detectFormat.ts";
import parseNewFormat from "./modules/formats/newFormat.ts";
import parseOldFormat, { readSaldoFinal } from "./modules/formats/oldFormat.ts";
import validate from "./modules/validate.ts";
import { toTransaction } from "./modules/transaction.ts";

if (process.argv.length < 3) {
  console.log("No filename argument provided!");
  process.exit(1);
}

const filename = process.argv[2];

let text;
try {
  text = await fs.readFile(filename, "utf-8");
} catch {
  console.log("Error reading text file!");
  process.exit(1);
}

const format = detectFormat(text);
const parsed = format === "new" ? parseNewFormat(text) : parseOldFormat(text);

/** Final balance of the previous month's statement, if its text file exists */
async function readPreviousSaldoFinal() {
  const name = path.basename(filename, ".txt");
  const match = name.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const previous = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  const previousName = previous.toISOString().slice(0, 7);
  try {
    const previousText = await fs.readFile(
      path.join(path.dirname(filename), previousName + ".txt"),
      "utf-8",
    );
    return readSaldoFinal(previousText);
  } catch {
    return null;
  }
}

const previousSaldoFinal =
  parsed.expected.kind === "old" ? await readPreviousSaldoFinal() : null;
if (parsed.expected.kind === "old" && previousSaldoFinal === null) {
  console.log("Previous statement not found, skipping the balance check");
}

const errors = validate(parsed, previousSaldoFinal);
for (const line of parsed.failed) {
  console.log("Failed to parse: " + line);
}
for (const error of errors) {
  console.log("Validation failed: " + error);
}
if (errors.length > 0) {
  process.exitCode = 1;
}

const transactionsDir = path.join(process.cwd(), "/transactions");
const outfile = path.basename(filename, ".txt");
const outfilePath = path.join(transactionsDir, outfile) + ".json";
try {
  await fs.writeFile(outfilePath, JSON.stringify(parsed.rows.map(toTransaction)));
} catch (e) {
  throw new Error(`Write to ${outfilePath} failed.`, { cause: e });
}

// Don't leave a stale failed-rows file from an earlier run behind
const failedRowsFilePath = path.join(transactionsDir, outfile + "_failed.json");
if (parsed.failed.length !== 0) {
  await fs.writeFile(failedRowsFilePath, JSON.stringify(parsed.failed.join("\n")));
} else {
  await fs.rm(failedRowsFilePath, { force: true });
}

console.log(`${outfile}: ${format} format, ${parsed.rows.length} transactions`);
