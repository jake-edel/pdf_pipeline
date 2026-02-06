const rowDateRegexp =
  /(\d{2} (?:ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC))\n/;

/**
 * Removes of the text in the string
 * leading up to the first transaction row
 * @returns - a new string
 */
function removeIntroduction(text: string) {
  // Start looking for the first date tag (eg. ENE 01, DIC 31)
  // This should correspond with the start of the transactions table
  const firstRowStart = text.match(rowDateRegexp);

  if (!firstRowStart?.[0]) {
    console.log("Row Start Regex failed");
    process.exit(1);
  }

  const rowStartIndex = text.indexOf(firstRowStart[0]);
  const sanitizedText = text.slice(rowStartIndex);

  return sanitizedText;
}

function removePageElements(text: string) {
  const regexChain = [
    /TRANSACCIONES.*\n/g,
    /.*MONTOS EN PESOS MEXICANOS\n/g,
    /JAKOB ANDREW EDELSTEIN\nTARJETA:\s.*\n.*\nRFC:.*\n/g,
    /\d+ de \d+\n/g,
    /\$/g,
  ];
  const sanitizedText = regexChain.reduce(
    (string, regexp) => string.replaceAll(regexp, ""),
    text,
  );

  return sanitizedText;
}

/**
 * Removes all of the text following the final period balance.
 * @returns - a new string
 */
function removeOutro(text: string) {
  const sanitizedText = text.split("Saldo final del periodo")[0].trim();
  return sanitizedText;
}

export function splitIntoRows(text: string): string[][] {
  const parts = text.split(rowDateRegexp);
  // Remove empty element at start
  // Inserted because rowDateRegexp has a capturing group
  parts.shift();
  const rows = [];
  for (let i = 0; i < parts.length; i += 2) {
    const row = (parts[i] + "\n" + parts[i + 1]).split("\n");
    rows.push(row);
  }

  return rows;
}

export default [removeIntroduction, removeOutro, removePageElements];
