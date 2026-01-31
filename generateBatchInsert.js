const transactions = require("./transacciones_junio.json");

const values = transactions.map(t => 
	`(\'${t.date}\', \'${t.vendor}\', ${t.amount}, \'${t.category}\')`)
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
