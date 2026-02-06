import fs from "node:fs/promises";

if (process.argv.length < 3) {
  console.log("No filename argument provided!");
  process.exit(1);
}

const filename = process.argv[2];
const jsonString = await fs.readFile(filename, "utf-8");

interface Transaction {
  date: string;
  category: string;
  merchant: string;
  amount: number;
}

const transactions: Transaction[] = JSON.parse(jsonString);

const values = transactions
  .map(
    (t) => `(\'${t.date}\', \'${t.merchant}\', ${t.amount}, \'${t.category}\')`,
  )
  .join(",\n");

const sql = `
INSERT INTO credit_card_transaction (
    transaction_date,
    merchant_name,
    transaction_amount,
    transaction_category
)
VALUES
${values};
`;

console.log(sql);
