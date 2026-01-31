import fs from 'node:fs'
import OpenAI from 'openai';
import 'dotenv/config'

if (!process.env.OPENAI_API_KEY) {
  console.log('No API Key is available!')
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

if (process.argv.length < 3) {
  console.log('No filename argument provided!')
  process.exit(1);
}

const filename = process.argv[2] 


fs.readFile(filename, (err, data) => {
  if (err) throw err
  const text = data.toString('utf-8')

  const pageTwoEnd = text.indexOf('2 de 5\n')
  const informationCostIndex = text.indexOf('INFORMACIÓN DE COSTOS')

  const transactions = text.slice(pageTwoEnd, informationCostIndex)

  const prompt = `
  You are extracting credit card transactions from a bank statement.

  Return ONLY valid JSON.
  No commentary.
  No markdown.

  Each transaction should have:
  - transaction_date (YYYY-MM-DD)
  - merchant
  - amount (negative for purchases, positive for payments)
  - description (raw statement text line)

  Statement text:
  ---
  ${transactions}
  ---
  `;

  async function query() {
   const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt
   })
  
   const output = response.output_text

   try {
    const json = JSON.parse(output)
    console.log(json);
   } catch {
    throw new Error ('JSON parse error!\n' + output)
   }
  }

  query().catch(error => {
    console.error(error);
    process.exit(1)
  })
})



