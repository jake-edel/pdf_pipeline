# CLAUDE.md

## What this is

A manual, three-stage pipeline that turns monthly credit card statement PDFs into a JSON array of transactions, and from that into CSVs for Firefly III's Data Importer.

```
pdfs/<provider>/YYYY-MM.pdf --src/extractPdfText.ts--> text/<provider>/YYYY-MM.txt --src/textToJson.ts--> transactions/<provider>/YYYY-MM.json --src/jsonToCsv.ts--> csv/<provider>/YYYY-MM.csv
```

`YYYY-MM` is the statement's **closing** month (e.g. `2026-04` covers 15 Mar – 14 Apr 2026). Downstream files inherit the PDF's base name. `<provider>` (e.g. `nu`, `bbva`) is whatever directory the PDF lives under in `pdfs/` — every stage derives it from its input file's parent directory and mirrors it into its output path, so no two providers' same-month files can collide. All three stages resolve their output directory relative to the cwd (run from the repo root).

## Commands

Requires `poppler-utils` (`pdftotext`, `pdfinfo`) and Node with native TypeScript support (runs `.ts` directly, no build step, imports use the `.ts` extension). There is no test suite.

```bash
# Stage 1: PDF -> text
node src/extractPdfText.ts pdfs/nu/2026-04.pdf       # one file, same as: npm run extract -- pdfs/nu/2026-04.pdf
npm run extract-all                                  # regenerate text/ for every PDF under pdfs/*/

# Stage 2: text -> JSON
node src/textToJson.ts text/nu/2026-04.txt           # same as: npm run parse -- text/nu/2026-04.txt
npm run parse-all                                     # regenerate transactions/ for every text file under text/*/

# Stage 3: JSON -> Firefly III CSV
node src/jsonToCsv.ts transactions/nu/2026-04.json   # same as: npm run csv -- transactions/nu/2026-04.json
npm run csv-all                                       # rebuild the category model, then regenerate csv/ for every provider
```

## The `Format` type

Formats, not providers, are what the parsing pipeline keys on. `<provider>` (the `pdfs/<provider>/` directory) only decides extraction mechanics — `src/modules/extractProfiles.ts` maps it to a page range and optional PDF password — and where files land; from `textToJson.ts` onward, everything works off the text's own content. That's the hook for provider-agnosticism: Nu alone needed two formats (`nu-old`, `nu-new`) when the bank changed its PDF layout in Apr 2026 — same provider, different format — while BBVA checking statements are a third format under a different provider, and nothing in the pipeline treats BBVA specially.

A `Format` (`src/modules/formats/types.ts`) bundles everything one statement layout needs into one self-contained object:

```ts
type Format<T extends ParsedStatement = ParsedStatement> = {
  id: string;
  detect(text: string): boolean;
  parse(text: string): T;
  needsPreviousStatement: boolean;
  reconcile(parsed: T, previousText: string | null): string[];
};
```

`src/modules/formats/index.ts` holds the list — currently `[nuOldFormat, nuNewFormat, bbvaChecking]` — and `detectFormat()` runs every format's `detect()` over the text and returns whichever one matches; zero or multiple matches is an error. Adding a format means writing one module (detection regexp, row regexp, reconciliation) and adding it to that list; `textToJson.ts` and everything upstream of it stay untouched.

`parse()` returns a `ParsedStatement` (`{ rows: Row[], failed: string[] }`), but each format's own return type extends it with whatever extra fields its `reconcile()` needs — `nu-old`: `saldoFinal`; `nu-new`: `charges`/`credits`; `bbva-checking`: cargo/abono totals and counts — typed end-to-end via `Format<T extends ParsedStatement>`. `reconcile()` is the format's own cross-check against the statement's printed totals, or, for `nu-old` (which prints none of its own), against the previous month's final balance; `needsPreviousStatement` tells `textToJson.ts` whether to bother reading that file at all.

Every format normalizes into the same `Row` shape (`src/modules/parse.ts`): `dateTransaction`, `dateCharge`, `category`, `merchant`, `counterparty`, `cents`. Fields a format doesn't have are just `null` (Nu never sets `counterparty`; `nu-new` has no `category`). One inconsistency formats don't normalize away: `cents`'s sign convention is per-format, documented in each format's own module — Nu is charge-positive (matching the printed statement); BBVA is deposit-positive/withdrawal-negative (its natural balance direction) — so code consuming a `Row` has to know which format produced it.

**One line = one row** still holds for Nu's two formats: everything needed for a transaction is on the row's own line, and continuation lines (`Tarjeta virtual **** 1983`, `Cambio (USD 1 = $17.47)` / `USD 20.00`, `Abono (Transferencia SPEI)`) are ignored outright, at the cost of losing original-currency amounts. BBVA's format relaxes this: it gathers each row's continuation lines up to the next row or the table end, filters out page-break boilerplate, and — when the last one looks like a bare name — uses it as `counterparty` (`gatherContinuation`/`counterpartyFrom` in `bbvaChecking.ts`), since SPEI rows print the counterparty on its own trailing line.

Row-lookalikes each format must not misparse as transactions: `nu-new` skips its page-3 installment table because the row regexp requires two dates and the table only has one; `nu-old` only reads between `TRANSACCIONES` and `Saldo final del periodo`, which is why a `SALDO A MESES` table appearing after `Saldo final del periodo` (seen in 2026-02) is excluded; `bbva-checking` treats a row-shaped line with no amount (an administrative notice like `APERTURA DE CUENTA`) as skippable rather than a parse failure.

`src/extractPdfText.ts` picks pdftotext's `-raw` vs `-layout` mode per file by sniffing for a `Página N de M` page-header line (also `nu-new`'s own `detect()`) — pdftotext's default mode detaches amounts from their rows and reorders them, and `-layout`/`-raw` are what keep each table row on one line. This happens before any format is detected, so it can't itself depend on `Format`; it's decided per file, not per provider.

## Code structure

`src/textToJson.ts` is the entry point: read text file, `detectFormat`, run the format's parser, validate, write JSON. Unparsable row-like lines go to `<name>_failed.json` (removed again on a clean run). Validation failures are printed and set exit code 1; the JSON is still written.

JSON row shape (the `Transaction` type in `modules/transaction.ts`, built by `toTransaction`): `{ date_transaction (ISO date), category_name (null when absent), opposing_name, description, amount }`. `amount` keeps whichever sign convention the source format used (see `Row.cents` above) — `opposing_name` falls back to `merchant` when a format's `counterparty` is `null`. `nu-new`'s `date_transaction` is the operation date (the charge date is parsed onto `Row.dateCharge` but not emitted). The JSON is statement-faithful and Firefly-agnostic; everything Firefly-specific lives in stage 3.

`src/modules/`:
- `formats/types.ts`, `formats/index.ts`: the `Format` type and the `detectFormat` registry — see above.
- `formats/nuOldFormat.ts`, `formats/nuNewFormat.ts`, `formats/bbvaChecking.ts`: one module per format, each owning its own row regexp, `parse`, and `reconcile`. `nu-old` also drops `Ajuste … Aumentaste tu límite de crédito con garantía` rows (credit-limit notices, not spending) by description; don't filter by category, since `Ajuste` is also used for a real refund.
- `parse.ts`: `Row` type (amounts in integer cents) and `parseAmount`.
- `dateUtils.ts`: month map, `toIsoDate`/`toIsoDateFromNumeric` (UTC, timezone-independent); `parseFullDate` for dates printed with their own year (`nu-new`); `toIsoDateInPeriod` for dates that need the statement period to resolve a missing year (`nu-old`, `bbva-checking`).
- `validate.ts`: checks that apply to every format regardless of layout — at least one row parsed, no row-like lines left unparsed. Format-specific checks (totals, saldo) live in each format's own `reconcile()`, covered above.

## Stage 3: Firefly III CSV

`src/jsonToCsv.ts` reads one `transactions/YYYY-MM.json` (checked with `isTransactionList`) and writes `csv/YYYY-MM.csv`. It reads only the JSON, never the text, so re-running it doesn't re-parse anything. Modules: `csv.ts` (generic RFC 4180 writer; merchants like `Crédito de "AMAZON"` contain quotes) and `firefly.ts` (everything Firefly-specific).

The **header row is the Data Importer role id of each column**, in this order: `date_transaction, description, amount_negated, opposing-name, category-name, external-id`. Note the importer's ids use hyphens (`opposing-name`, `category-name`) while the JSON keys use underscores.

- **Amounts keep the statement's sign** (charge +, payment −). The importer's `amount_negated` role flips it, which is what Firefly's maintainer recommends for card statements. Don't flip signs in our code.
- **Card payments are omitted** (`isCardPayment`: negative, and `Pago a tu tarjeta de crédito` or `¡Grácias por tu pago!`), because the bank account is imported too and creates the transfer from its side. The script logs `skipped N payment row(s)`; if the bank rewords the payment line it would slip through as a deposit, so extend the regexp. Refunds (`Devolución`, `Crédito de "…"`, `Abono de "…"`) are kept.
- **`external-id`** = `<statement>-<12 hex of sha1(statement | merchant | cents | occurrence)>`, where `occurrence` counts identical merchant+amount rows earlier in the same file. It exists because rows identical on date, merchant and amount are real (2025-12 has some) and Firefly's default content-hash duplicate detection would silently drop them. The date is deliberately not part of the id, so switching between operation/charge date doesn't change ids. Ids are content-derived: once a file is imported, a parser change that alters a merchant string would make its rows look new.

The importer config is built once by the user in the Data Importer UI (their saved mappings live there; we don't generate it). Settings it needs: flow CSV, date format `Y-m-d`, delimiter comma, headers yes, roles = the header row above, duplicate detection by identifier (`cell`) on the `external-id` column, target = the card as an **asset account** (credit-card role, `default_account`). Optional: apply rules (categorises the category-less new-format rows), mappings for `opposing-name`/`category-name`. Unverified until a first real import: whether empty `category-name` cells are ignored, and whether `unique_column_index` is 0- or 1-based (the UI selects the column).

Not done on purpose: generating the importer config, a `date_book` column for the charge date, foreign-currency columns, merchant normalisation (left to Firefly rules/mapping; ~190 distinct merchant names so far).

The generated Firefly III import config lives in the root directory for reference.
