# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A manual, two-stage pipeline that turns monthly credit card statement PDFs (Nu México, Spanish-language, MXN) into a JSON array of transactions. The stages are run by hand on purpose during development; don't add orchestration or automation unless asked.

```
pdfs/<month YYYY>.pdf --extract_pdf_text.sh--> text/<month YYYY>.txt --src/textToJson.ts--> transactions/<month YYYY>.json
```

## Commands

Requires `poppler-utils` (`pdftotext`, `pdfinfo`) and Node with native TypeScript support (runs `.ts` directly, no build step, imports use the `.ts` extension). There is no test suite, linter, or tsconfig.

```bash
# Stage 1: PDF -> text (writes to text/, always relative to the script's location)
./extract_pdf_text.sh "pdfs/abril 2026.pdf"          # one file
ls pdfs/*.pdf | ./extract_pdf_text.sh                # bulk: one path per line on stdin

# Stage 2: text -> JSON
node src/textToJson.ts "text/abril 2026.txt"         # same as: npm run parse -- "text/abril 2026.txt"
```

Filenames contain spaces; always quote them.

`pdfs/`, `text/`, `transactions/` are gitignored and hold real financial data. `wip/` (untracked) is scratch output for in-progress parser work.

## Two statement formats

The bank changed its PDF layout starting with the April 2026 statement (covering mid-Mar to mid-Apr). Both formats must keep working; the older ones are Jun 2025 – Mar 2026, the newer ones Apr 2026 onward. Nothing ties a file to a format except its content:

| | Old | New |
|---|---|---|
| Detect | no `Página N de M` line | has `Página N de M` page headers |
| pdftotext mode | `-layout` | `-raw` |
| Section markers | starts at `TRANSACCIONES`, ends at `Saldo final del periodo` | table under `Fecha de la operación / Fecha de cargo / Descripción del movimiento / Monto`; no end marker |
| Row shape | `DD MON` / category / merchant / `$amount` (`- $x` for payments) | `DD MON YYYY` / `DD MON YYYY` / `Merchant \| RFC: S.I.` / `+$x` or `-$x` |
| Category | present | not present |
| Year on dates | absent (must come from the `DE 15 JUL 2025 A 14 AGO 2025` header line) | present |

`extract_pdf_text.sh` picks the pdftotext mode per file by sniffing for the `Página N de M` header. This matters: with pdftotext's default mode, amounts get detached from their rows and reordered, which was the source of most `_failed.json` rows. `-layout`/`-raw` keep each table row on one line.

Things that still have to be handled downstream in the new format: the page-3 installment table (`DESGLOSE DE MOVIMIENTOS`, uses the same date style but the amounts are on separate lines), page header/footer lines, and continuation lines under a row (`Tarjeta virtual **** 1983`, `Cambio (MXN 1 = $1.00)` / `MXN 110.00`). In the old format, long descriptions wrap onto an indented second line with no date (e.g. the `Ajuste` row).

## Code structure

`src/textToJson.ts` is the entry point: read text file, run `sanitationPipeline` (an exported array of string-to-string functions applied with `reduce`), split into rows via `handleRowSplit`, validate each row has exactly 4 lines, map to objects, write JSON. Rows failing validation go to `<name>_failed.json`.

Output row shape: `{ date_transaction (ISO date), category_name, opposing_name, description, amount }`.

`src/modules/` holds the pieces: `sanitationPipeline.ts` (intro/outro/page-element stripping), `handleRowSplit.ts` (split on the date line and regroup), `dateUtils.ts` (`15 JUL` to ISO date).

## Known state and gotchas

- The sanitizer/parser are mid-migration to the new format. The working tree's `textToJson.ts` currently skips row parsing and dumps the sanitized text into `wip/` for inspection, and `removeIntroduction` looks for the new format's `movimiento\nMonto` marker, so it does not work on old-format text. Check `git status`/`git diff` before assuming what state the parser is in; committed HEAD handles old format only.
- `dateUtils.ts` hardcodes the year 2025, which is wrong for any statement from 2026 (and for the old format's Jan-Feb statements that span a year boundary).
- `handleRowSplit.ts` and `sanitationPipeline.ts` each define their own `rowDateRegexp` and they have diverged.
- `README.md` and `.vscode/launch.json` still reference an old `data/` directory layout and the README mentions an OpenAI API step that isn't in the code; treat them as stale.
