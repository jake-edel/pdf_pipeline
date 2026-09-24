/**
 * Same test as extract_pdf_text.sh: only the new statements
 * have `Página N de M` page headers.
 */
export default function detectFormat(text: string): "old" | "new" {
  return /^Página \d+ de \d+/m.test(text) ? "new" : "old";
}
