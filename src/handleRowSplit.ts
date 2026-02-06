const rowDateRegexp = /(\d{2} (?:ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC))\n/

function splitIntoRows(text: string): string[] {
  // Split the text up on the date regex
  const rows = text.split(rowDateRegexp)
  // The caputuring group will place each date
  // into their own element in the array
  rows.shift() 

  return rows
}

function recombineRows(rows: string[]) {
  // Combine the date back with the rest of the row data
  const recombineRows = [];
  for (let i = 0; i < rows.length; i += 2) {
    const row = (rows[i] + "\n" + rows[i + 1]);
    recombineRows.push(removeTrailingNewline(row))
  }
  return recombineRows
}

const removeTrailingNewline = (string: string) => 
  string.endsWith("\n") 
    ? string.slice(0, string.length - 1)
    : string

export default function handleRowSplit(text: string): string[][] {
  let rows = []
  rows = splitIntoRows(text);
  rows = rows.map(removeTrailingNewline)
  rows = recombineRows(rows)
  rows = rows.map(row => row.split("\n"))

  return rows
}