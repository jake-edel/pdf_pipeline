/** RFC 4180: quote a field if it contains a quote, comma or line break */
function escapeField(field: string) {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(escapeField).join(",") + "\n").join("");
}
