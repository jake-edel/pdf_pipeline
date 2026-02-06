import fs from "node:fs/promises";
import "dotenv/config";
import sanitationPipeline from "./textSanitation.ts";
import handleRowSplit from "./handleRowSplit.ts";
import handleDateFormat from "./dateUtils.ts";

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

const failedRows: string[][] = []
const validatedRows = rows.filter((row, index )=> {
  if (row.length !== 4) {
    console.log(`Row Index ${index} failed length validation\n` + row + "\n")
    failedRows.push(row)
    return false
  }
  return true
})

const rowObjs = validatedRows.map(row => {
  const [ date, category, merchant, amount ] = row

  const value = Number.parseFloat(amount?.replaceAll(/[,|\s]/g, ""))

  const formattedDate = handleDateFormat(date)

  return {
    date: formattedDate,
    category,
    merchant,
    amount: value
  }
})

fs.writeFile('transactions.json', JSON.stringify(rowObjs))