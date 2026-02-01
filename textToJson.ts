import fs from "node:fs/promises";
import "dotenv/config";
import { splitIntoRows } from "./textSanitation.ts";
import sanitationPipeline from "./textSanitation.ts";

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

const rows = splitIntoRows(sanitizedText);

console.log(rows);

function validateRowLength(rows: string[][]) {
  rows.forEach((row, index) => {
    const rowNumber = index + 1
    if (row.length != 4)
      console.log(`Row ${rowNumber} did not pass length check!\n` + row + "\n");
  })
}

validateRowLength(rows)

const rowObjs = rows.map(row => {
  const [category, merchant, amount, date] = row
  return { category, merchant, amount, date }
})

console.log(rowObjs)

