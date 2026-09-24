# PDF pipeline: generalizing beyond Nu México

Sep 23, 2026 · @Someone

## Summary

The pipeline is provider-agnostic from the JSON stage onward; stages 1 and 2 are tied to Nu México, and a BBVA parser would currently need edits in the entry script, the validator, the extraction script and the payment filter as well as the parser itself.

The "old"/"new" split is the right idea (several layouts, chosen by content), but it is hard-coded as a two-value enum in `detectFormat.ts`, `Expected`/`validate.ts` and `textToJson.ts`. BBVA cuenta de nómina is also a different kind of statement (a debit account with a running balance, not a credit card), so it stresses the model more than a second card layout would.

**Recommendation:** replace the enum with a registry of format descriptors, each owning detection, parsing, reconciliation and its extraction settings. Do this before writing the BBVA parser, keeping Nu output byte-identical.

## Already generic

The data model and stage 3 are neutral, which is where most of the value sits.

- **`Row` and `Transaction`**: integer cents, signed amounts, ISO dates, nullable `category` and `dateCharge`.
- **`{ rows, failed, expected }`**: the contract every parser returns, so parsers can be swapped without touching the rest.
- **`csv.ts`** and the column table, `externalIds` and CSV writing in **`firefly.ts`**: they read only `Transaction`.
- **`parseAmount`, `toIsoDate` and the `failed` mechanism**: reusable in shape, though still Spanish and MXN in practice (see below).

## Where it breaks down

Every break is in stage 1, stage 2 or the payment filter in stage 3; none is in the data model itself.

| Area | Where | Problem | Impact on BBVA |
| --- | --- | --- | --- |
| Format selection | `detectFormat.ts`, `textToJson.ts:26` | `"old" \| "new"` enum keyed on Nu's `Página N de M`; a ternary picks the parser | No place for a third format |
| Reconciliation | `parse.ts` `Expected`, `validate.ts`, `textToJson.ts:40` | Union hard-coded to two Nu kinds; the entry script special-cases `kind === "old"` to fetch the previous month's file | BBVA needs its own check |
| PDF extraction | `extract_pdf_text.sh` | Hard-coded password (`-opw`, uncommitted), pages 3 to N-1, `-raw`/`-layout` sniffed from a Nu-only marker | Different page range and password |
| Format sniffing | `detectFormat.ts` and the shell script | The same test lives in two places | Drift risk |
| Locale | `dateUtils.ts`, `parseAmount` | Spanish 3-letter months, `DD MON YYYY`, `$1,234.56` only | BBVA may print numeric dates or separate cargo/abono columns |
| Row model | `parse.ts`, `transaction.ts` | One line = one row; no currency, posting date or memo; `description` always equals `merchant` | Wrapped descriptions; no place for a reference or running balance |
| Payment filter | `firefly.ts` `cardPaymentRegexp` | Matches Nu's exact payment strings | Wrong for a debit account (see next section) |
| Namespacing | output paths, `externalIds` | Files keyed on PDF base name alone; provider absent from the id hash | `2026-04.pdf` from two banks overwrites and collides |

Smaller points: `getCategories.ts` imports `modules/category/tokenize.ts`, which is not in the tree I read, and the `ignoredMerchant` filter sits inside `oldFormat.ts` with no shared home for per-format noise rules.

## BBVA cuenta de nómina

A payroll account is a debit account, so it differs from Nu's credit-card statements in meaning as well as layout. No BBVA statement has been examined yet: the points below are expectations to check against a real PDF.

| Aspect | Nu (credit card) | BBVA nómina (expected) | What it changes |
| --- | --- | --- | --- |
| Sign convention | Charge +, payment − | Deposits (abonos) increase the balance, withdrawals (cargos) decrease it | Stage 2 must map to one sign rule; Firefly's `amount_negated` role would then be wrong for this account |
| Amount columns | One amount per row | Likely separate cargo and abono columns, possibly a running balance | Row regexps and `parseAmount` need a two-column case |
| Reconciliation | Row totals, or the previous statement's final balance | Opening balance + abonos − cargos = closing balance, plus a per-row balance chain if printed | A new check kind, ideally checked row by row |
| Dates | `DD MON [YYYY]` | Possibly operation and settlement dates, abbreviated months, year implied by the period | Reuse `toIsoDateInPeriod`; month spellings must be verified |
| Descriptions | Merchant only | Often multi-line (SPEI, transfer references, tracking keys) | Breaks "one line = one row" |
| Payments | Card payment rows are dropped | Transfers to the Nu card and other own accounts | The card-payment filter has to become account-aware to avoid double-counting |
| Firefly target | Asset account (credit card) | Asset account (checking); transfers, deposits and withdrawals | Separate importer config and separate sign role |
| PDF | Password, pages 3 to N-1 | Unknown | Extraction settings per format |

Two consequences matter for the design. First, the sign and payment rules cannot stay global in `firefly.ts`; they need to belong to the format or account. Second, dropping own-account transfers is correct only if both sides are imported, so the double-counting rule needs to be explicit per pair of accounts.

## Proposed design

The extension point should be a format descriptor in a registry, not an enum. Each descriptor owns everything that varies by bank.

```ts
type Format = {
  id: string;                          // "nu-mx/v1", "nu-mx/v2", "bbva-nomina"
  extract: { pages: [number, number]; mode: "raw" | "layout"; passwordEnv?: string };
  detect(text: string): boolean;       // content sniff, tried in order
  parse(text: string): ParsedStatement;
  reconcile(parsed, ctx): string[];    // each format owns its own check
  amountSign: "charge-positive" | "deposit-positive";
  isOwnTransfer?(t: Transaction): boolean;
};
```

- **Registry**: a `formats/index.ts` array replaces `detectFormat` and the ternary. Zero or several matches is an error.
- **Reconciliation**: `Expected` and the `kind` branches go away; `validate.ts` keeps only the shared checks (no rows, failed lines). The previous-statement lookup moves into the context passed to `reconcile`.
- **Extraction**: replace the shell script with a small Node wrapper around `pdftotext`, driven by the descriptor, so detection happens once. The password comes from an environment variable.
- **Namespacing**: write to `transactions/<format-provider>/YYYY-MM.json` and include the provider in the `external-id` hash. Existing Nu ids need a special case so they stay unchanged.
- **Model**: add optional `currency`, `date_posted`, `memo` and `balance` to `Row` and `Transaction`, and keep `isTransactionList` tolerant. `balance` lets BBVA reconcile row by row.
- **Locale**: give each format its own `parseDate` and `parseAmount`, keeping the current ones as the Spanish/MXN defaults.
- **Stage 3**: sign handling and payment filtering move onto the descriptor; the Firefly column table stays shared.

## Order of work

Do the refactor first with Nu only, then let the BBVA statement drive the model changes.

1. **Registry and reconciliation**: introduce the descriptor, port `oldFormat` and `newFormat` onto it, delete `Expected` and the `kind` branches. Verify by diffing `transactions/*.json` before and after; they must be byte-identical.
2. **Extraction config**: move password, page range and mode into the descriptor and replace the shell script with the Node wrapper. Verify that regenerated `text/` files are unchanged.
3. **Namespacing**: add the provider to output paths and to the `external-id` hash, preserving existing Nu ids.
4. **Collect a real BBVA statement** and read the raw `pdftotext` output in both modes before choosing row regexps and the sign rule.
5. **BBVA parser and reconciliation**: add the model fields it needs, write the balance-chain check, then decide the own-transfer rule together with the Firefly config for the account.
6. **Locale helpers** only if the BBVA text needs them.

Open questions: whether BBVA statements print a running balance per row, whether the PDF is password-protected, and which other accounts are imported into Firefly (this decides the transfer handling).
