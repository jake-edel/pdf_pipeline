import fs from "node:fs/promises";
import path from "node:path"
import sanitationPipeline from "./modules/sanitationPipeline.ts";
import handleRowSplit from "./modules/handleRowSplit.ts";
import handleDateFormat from "./modules/dateUtils.ts";

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

const sanitizedText = sanitationPipeline.reduce((acc, fn) => fn(acc), text);
const rows = handleRowSplit(sanitizedText);

const failedRows: string[] = [];
const validatedRows = rows.filter((row, index) => {
  if (row.length !== 4) {
    console.log(`Row Index ${index} failed length validation\n` + row + "\n");
    failedRows.push(row.join(" ,"));
    return false;
  }
  return true;
});

const rowObjs = validatedRows.map((row) => {
  const [date, category, merchant, amount] = row;

  const value = Number.parseFloat(amount?.replaceAll(/[,|\s]/g, ""));

  const formattedDate = handleDateFormat(date);

  return {
    date_transaction: formattedDate,
    category_name: category,
    opposing_name: merchant,
    description: merchant,
    amount: value,
  };
});

const transactionsDir = path.join(process.cwd(),'data/transactions')
const outfile = path.basename(filename, ".txt")
const outfilePath = path.join(transactionsDir, outfile) + ".json"

const failedRowsFile = outfile + "_failed.json"
const failedRowsFilePath = path.join(transactionsDir, failedRowsFile)

fs.writeFile(outfilePath, JSON.stringify(rowObjs));
fs.writeFile(failedRowsFilePath, JSON.stringify(failedRows.join("\n")));
