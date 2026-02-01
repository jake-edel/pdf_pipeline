import fs from "node:fs";
import OpenAI from "openai";
import "dotenv/config";

if (!process.env.OPENAI_API_KEY) {
  console.log("No API Key is available!");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (process.argv.length < 3) {
  console.log("No filename argument provided!");
  process.exit(1);
}

const filename = process.argv[2];

fs.readFile(filename, (err, data) => {
  if (err) throw err;

  const text = data.toString("utf-8");
  
  let sanitizedText = text

  // Now start looking for the date tag
  // Each one corresponding with the start of a row
  const rowStartRegex = /(\d{2} (?:ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC))\n/
  const firstRowStart = sanitizedText.match(rowStartRegex)
  if (!firstRowStart?.[0]) {
    console.log("Row Start Regex failed");
    process.exit(1)
  }
  const rowStartIndex = sanitizedText.indexOf(firstRowStart[0])
  sanitizedText = sanitizedText.slice(rowStartIndex)



  // Remove chunks of account information 
  const accountInfoRegex = /JAKOB ANDREW EDELSTEIN\nTARJETA:\s.*\n.*\nRFC: .*/g;
  sanitizedText = sanitizedText.replaceAll(accountInfoRegex, "");

  // Clear out page counts at the end of each page
  const pageCountRegex = /\d+ de \d+/g
  sanitizedText = sanitizedText.replaceAll(pageCountRegex, "")

  sanitizedText = sanitizedText
  // Remove all empty lines (including multiples)
    .replaceAll(/\n\s*\n+/g, "\n")
  
  sanitizedText = sanitizedText.split("Saldo final del periodo")[0].trim();

  const parts = sanitizedText.split(rowStartRegex)
  // Remove empty element at start
  // Inserted because rowStartRegex has a capturing group
  parts.shift() 
  
  const rows = [];
  for (let i = 1; i < parts.length; i += 2) {
    const row = (parts[i] + " " + parts[i + 1]).split("\n");
    rows.push(row)
  }
  console.log(rows)

  // const prompt = `
  // You are extracting credit card transactions from a bank statement.

  // Return ONLY valid JSON.
  // No commentary.
  // No markdown.

  // Each transaction should have:
  // - transaction_date (YYYY-MM-DD)
  // - merchant
  // - amount (negative for purchases, positive for payments)
  // - description (raw statement text line)

  // Statement text:
  // ---
  // ${transactions}
  // ---
  // `;

  // async function query() {
  //   const response = await client.responses.create({
  //     model: "gpt-4.1-mini",
  //     input: prompt,
  //   });

  //   const output = response.output_text;

  //   try {
  //     const json = JSON.parse(output);
  //     console.log(json);
  //   } catch {
  //     throw new Error("JSON parse error!\n" + output);
  //   }
  // }

  // query().catch(error => {
  //   console.error(error);
  //   process.exit(1)
  // })
});
