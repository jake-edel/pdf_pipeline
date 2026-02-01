import fs from "node:fs/promises";
import "dotenv/config";
import textSanitation from "./textSanitation.ts";
const {
  removeIntroduction,
  removeAccountInfo,
  removePageCounts,
  removeOutro,
  splitIntoRows
} = textSanitation

if (process.argv.length < 3) {
  console.log("No filename argument provided!");
  process.exit(1);
}

const filename = process.argv[2];

let text
try {
  text = await fs.readFile(filename, 'utf-8')
} catch {
  console.log("Error reading text file!")
  process.exit(1)
}

const textTransformers = [
  removeIntroduction,
  removeAccountInfo,
  removePageCounts,
  removeOutro
]

const sanitizedText = textTransformers.reduce(
  (acc, fn)=> {return fn(acc)},
  text
)

const rows = splitIntoRows(sanitizedText)

console.log(rows)