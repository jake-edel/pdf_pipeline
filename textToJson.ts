import fs from "node:fs/promises";
import "dotenv/config";
import sanitationPipeline from "./textSanitation.ts";
import handleRowSplit from "./handleRowSplit.ts";

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
const rows = handleRowSplit(sanitizedText)

const hasValidRowLength = (row: string[]) => row.length === 4
const sanitizeTransactionAmount = (val: string) => Number.parseFloat(val?.replaceAll(/[,|\s]/g, ""))

const failedRows: string[][] = []
const rowObjs = rows.filter((row, index )=> {
  if (!hasValidRowLength(row)) {
    console.log(`Row Index ${index} failed length validation\n` + row + "\n")
    failedRows.push(row)
    return false
  }

  const [ date, category, merchant, amount ] = row
  const value = sanitizeTransactionAmount(amount)
  return { date, category, merchant, amount: value }
})

console.log(rowObjs)
console.log('Failed rows:\n', failedRows)

