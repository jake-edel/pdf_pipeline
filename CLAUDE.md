# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A manual, two-stage pipeline that turns monthly credit card statement PDFs (Nu México, Spanish-language, MXN) into a JSON array of transactions. The stages are run by hand on purpose during development; don't add orchestration or automation unless asked.

```
pdfs/YYYY-MM.pdf --extract_pdf_text.sh--> text/YYYY-MM.txt --src/textToJson.ts--> transactions/YYYY-MM.json
```

`YYYY-MM` is the statement's **closing** month (e.g. `2026-04` covers 15 Mar – 14 Apr 2026). Downstream files inherit the PDF's base name.

## Commands

Requires `poppler-utils` (`pdftotext`, `pdfinfo`) and Node with native TypeScript support (runs `.ts` directly, no build step, imports use the `.ts` extension). There is no test suite.

```bash
# Stage 1: PDF -> text (writes to text/, always relative to the script's location)
./extract_pdf_text.sh pdfs/2026-04.pdf               # one file
npm run extract                                      # regenerate text/ for every PDF in pdfs/

# Stage 2: text -> JSON
node src/textToJson.ts text/2026-04.txt              # same as: npm run parse -- text/2026-04.txt

# Checks
tsc                                                  # type-check only (noEmit); global tsc from ~/.dotfiles/nvim/lsp-tools
npx eslint                                           # typescript-eslint recommended rules
```

`tsc` is deliberately not a project dependency; it's a global install (5.9.3). A local `typescript@5.9.3` is pinned in devDependencies only because `typescript-eslint` imports it, and it should be kept in step with the global one. `tsconfig.json` sets `erasableSyntaxOnly`, so avoid enums, namespaces and parameter properties (Node's type stripping can't run them).

`pdfs/`, `text/`, `transactions/` are gitignored and hold real financial data. `wip/` (untracked) is scratch output for in-progress parser work.

## Two statement formats

The bank changed its PDF layout starting with the April 2026 statement (covering mid-Mar to mid-Apr). Both formats must keep working; the older ones are Jun 2025 – Mar 2026, the newer ones Apr 2026 onward. Nothing ties a file to a format except its content:

| | Old | New |
|---|---|---|
| Detect | no `Página N de M` line | has `Página N de M` page headers |
| pdftotext mode | `-layout` | `-raw` |
| Section markers | starts at `TRANSACCIONES`, ends at `Saldo final del periodo` | table under a `Fecha de la` / `operación` / `Fecha de cargo Monto Descripción del movimiento` header (repeated each page); no end marker |
| Row shape | `DD MON`, category, merchant, `$amount` (`- $x` for payments), columns split by 2+ spaces | `DD MON YYYY DD MON YYYY Merchant \| RFC: S.I. +$x` (`-$x` for payments/credits) |
| Category | present, blank on refunds like `Devolución` | not present |
| Dates | one, no year (year comes from the `DE 15 JUL 2025 A 14 AGO 2025` header line) | two, with year: operación and cargo |

`extract_pdf_text.sh` picks the pdftotext mode per file by sniffing for the `Página N de M` header. This matters: with pdftotext's default mode, amounts get detached from their rows and reordered. `-layout`/`-raw` keep each table row on one line.

**One line = one row.** The parser assumes everything it needs for a transaction is on the row's own line and ignores all other lines, including continuation lines under a row (`Tarjeta virtual **** 1983`, `Cambio (USD 1 = $17.47)` / `USD 20.00`, `Abono (Transferencia SPEI)`, wrapped old-format text). This holds for all current statements; the cost is losing original-currency amounts.

Row-lookalikes that must not be parsed as transactions: the new format's page-3 installment table (single line, but only one date, so the two-date row regexp skips it) and, in old files from 2026-02, a `SALDO A MESES` table after `Saldo final del periodo` (which is why the old parser only reads between `TRANSACCIONES` and `Saldo final del periodo`). Also, the new format's `Notas: …` page footer is glued to the next page's `Número de tarjeta…` on one line, so don't rely on line-anchored page-element stripping there.

## Code structure

`src/textToJson.ts` is the entry point: read text file, `detectFormat`, run the format's parser, validate, write JSON. Unparsable row-like lines go to `<name>_failed.json` (removed again on a clean run). Validation failures are printed and set exit code 1; the JSON is still written.

Output row shape (built in `toOutput`, the one place that knows the target format): `{ date_transaction (ISO date), category_name (null when absent), opposing_name, description, amount }`. Charges are positive, payments/credits negative. The new format's `date_transaction` is the operation date (the charge date is parsed onto `Row.dateCharge` but not emitted). The output is eventually imported into Firefly III; that mapping (sign flip, payments as transfers, CSV) is deliberately deferred.

`src/modules/`:
- `detectFormat.ts`: `old` vs `new`, same test as the extract script.
- `formats/newFormat.ts`, `formats/oldFormat.ts`: each returns `{ rows, failed, expected }`. The old parser also drops the `Ajuste … Aumentaste tu límite de crédito con garantía` rows (credit-limit notices, not spending) by description; don't filter by category, since `Ajuste` is also used for a real refund.
- `parse.ts`: `Row` type (amounts in integer cents) and `parseAmount`.
- `dateUtils.ts`: month map, `toIsoDate` (UTC, timezone-independent), and year resolution from the statement period for old-format rows.
- `validate.ts`: new format, row sums must equal the printed `Total de cargos` / `Total de abonos`. Old format, `Saldo final` minus the row sum must equal the previous statement's `Saldo final` (read from the previous month's text file; skipped if it's absent, e.g. 2025-06). Both hold exactly for all current files.

## Known state and gotchas

- `README.md` and `.vscode/launch.json` still reference an old `data/` directory layout and the README mentions an OpenAI API step that isn't in the code; treat them as stale.
