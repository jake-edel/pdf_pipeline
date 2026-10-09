import {
  monthPattern,
  toIsoDateFromNumeric,
  toIsoDateInPeriod,
} from "../dateUtils.ts";
import type { Row } from "../parse.ts";
import type { Format, ParsedStatement } from "./types.ts";

// Periodo                                       DEL 05/12/2025 AL 04/01/2026
const periodRegexp =
  /Periodo\s+DEL (\d{2})\/(\d{2})\/(\d{4}) AL (\d{2})\/(\d{2})\/(\d{4})/;

const tableStart = "Detalle de Movimientos Realizados";
const tableEnd = "Total de Movimientos";

// TOTAL IMPORTE CARGOS      193,667.27   TOTAL MOVIMIENTOS CARGOS      16
const cargosTotalRegexp =
  /TOTAL IMPORTE CARGOS\s+([\d,]+\.\d{2})\s+TOTAL\s+MOVIMIENTOS CARGOS\s+(\d+)/;
// TOTAL IMPORTE ABONOS      138,577.31   TOTAL  MOVIMIENTOS ABONOS      5
const abonosTotalRegexp =
  /TOTAL IMPORTE ABONOS\s+([\d,]+\.\d{2})\s+TOTAL\s+MOVIMIENTOS ABONOS\s+(\d+)/;

// 11/DIC   11/DIC SPEI RECIBIDOJP MORGAN                       30,668.60    117,722.60   117,722.60
// Not pre-trimmed: cargo/abono has no sign character, so classifying it
// needs the amount's actual column position (see classifyAmount below),
// which only survives in the raw, un-trimmed -layout line.
const date = `\\d{2}\\/(?:${monthPattern})`;
const rowRegexp = new RegExp(
  `^\\s*(${date})\\s+(${date})\\s+(.+?)\\s{2,}([\\d,]+\\.\\d{2})(?:\\s+([\\d,]+\\.\\d{2})\\s+([\\d,]+\\.\\d{2}))?\\s*$`,
  "d",
);
const rowStartRegexp = new RegExp(`^\\s*${date}\\s+${date}\\s`);

// Recurring page-break boilerplate that can interrupt a row's own
// continuation lines (reference numbers, counterparty name) when it falls
// right before a page boundary.
const pageNoiseRegexp =
  /^(BBVA MEXICO, S\.A\.,|Av\. Paseo de la Reforma|Estado de Cuenta$|Libretón Premium$|PAGINA \d+ \/ \d+$|No\. de Cuenta|No\. de Cliente|FECHA|OPER\s+LIQ\s+DESCRIPCIÓN)/;

// A dedicated trailing line of pure name text (no digits, no reference
// codes) — only SPEI rows reliably print one. Validated against the full
// 970-row corpus: 245/276 SPEI rows resolve a name this way, 1 false
// positive across the other 749 rows ("COMPENSACION POR RETRASO" /
// "COMP SPEI", accepted as noise).
const nameLikeRegexp = /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü.'\- ]+$/;

/** Bare `1,234.56` (no `$`, unlike parseAmount) to integer cents */
function parsePesos(amount: string) {
  const match = amount.match(/^([\d,]+)\.(\d{2})$/);
  if (!match) {
    throw new Error(`Amount ${amount} does not match RegExp pattern`);
  }
  const [, whole, fraction] = match;
  return (
    Number.parseInt(whole.replaceAll(",", "")) * 100 + Number.parseInt(fraction)
  );
}

/** Cargo (withdrawal) column starts well left of abono (deposit); see module header */
function isCargo(amountStart: number) {
  return amountStart < 105;
}

type BbvaCheckingParsedStatement = ParsedStatement & {
  totalCargoCents: number;
  totalAbonoCents: number;
  cargoCount: number;
  abonoCount: number;
};

/**
 * Lines after a row, up to (not including) the next row or the end of the
 * table — page-break boilerplate filtered out, so the real last line (the
 * counterparty name, when present) survives a page break intact.
 */
function gatherContinuation(lines: string[], from: number, upTo: number) {
  const continuation: string[] = [];
  let i = from;
  for (; i < upTo; i++) {
    if (rowStartRegexp.test(lines[i])) break;
    const trimmed = lines[i].trim();
    if (trimmed && !pageNoiseRegexp.test(trimmed)) continuation.push(trimmed);
  }
  return { continuation, next: i };
}

/**
 * SPEI rows print the counterparty as a dedicated trailing line; everything
 * else's continuation lines mix in reference codes, which fail the
 * name-shape test. When found, the row's own first continuation line (its
 * free-text transfer memo, e.g. "Renta", "cenote 5 ene") is folded in too —
 * concatenated for now rather than split into its own field, since the
 * memo is often glued to a reference number with no delimiter.
 */
function counterpartyFrom(continuation: string[]) {
  if (continuation.length === 0) return null;

  const last = continuation[continuation.length - 1];
  const isName =
    nameLikeRegexp.test(last) && last.trim().split(/\s+/).length >= 2;
  if (!isName) return null;

  const memo = continuation[0];
  return continuation.length > 1 ? `${last} (${memo})` : last;
}

function parse(text: string): BbvaCheckingParsedStatement {
  const period = text.match(periodRegexp);
  if (!period) {
    throw new Error(
      "Could not find the statement period (Periodo DEL ... AL ...)",
    );
  }
  const [, startDay, startMonth, startYear, endDay, endMonth, endYear] = period;
  const periodStart = toIsoDateFromNumeric(
    Number.parseInt(startDay),
    Number.parseInt(startMonth),
    Number.parseInt(startYear),
  );
  const periodEnd = toIsoDateFromNumeric(
    Number.parseInt(endDay),
    Number.parseInt(endMonth),
    Number.parseInt(endYear),
  );

  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === tableStart);
  const end = lines.findIndex((line) => line.trim() === tableEnd);
  if (start === -1 || end === -1) {
    throw new Error("Could not find the transactions table");
  }

  const rows: Row[] = [];
  const failed: string[] = [];

  let i = start + 1;
  while (i < end) {
    const line = lines[i];
    const match = rowRegexp.exec(line);
    if (match) {
      const [, dateOper, dateLiq, descriptionRaw, amount] = match;
      const description = descriptionRaw.trim();
      const [operDay, operMonth] = dateOper.split("/");
      const [liqDay, liqMonth] = dateLiq.split("/");
      const amountStart = match.indices![4][0];

      const { continuation, next } = gatherContinuation(lines, i + 1, end);

      rows.push({
        dateTransaction: toIsoDateInPeriod(
          operDay,
          operMonth,
          periodStart,
          periodEnd,
        ),
        dateCharge: toIsoDateInPeriod(liqDay, liqMonth, periodStart, periodEnd),
        category: null,
        merchant: description,
        counterparty: counterpartyFrom(continuation),
        cents: isCargo(amountStart) ? -parsePesos(amount) : parsePesos(amount),
      });
      i = next;
      continue;
    }

    if (rowStartRegexp.test(line)) {
      // A row-shaped line with no amount at all is an administrative
      // notice (e.g. "APERTURA DE CUENTA"), not a parsing failure.
      if (/[\d,]+\.\d{2}/.test(line)) {
        failed.push(line.trim());
      }
    }
    i++;
  }

  const totals = text.match(cargosTotalRegexp);
  const credits = text.match(abonosTotalRegexp);
  if (!totals || !credits) {
    throw new Error("Could not find the TOTAL IMPORTE CARGOS/ABONOS lines");
  }

  return {
    rows,
    failed,
    totalCargoCents: parsePesos(totals[1]),
    cargoCount: Number.parseInt(totals[2]),
    totalAbonoCents: parsePesos(credits[1]),
    abonoCount: Number.parseInt(credits[2]),
  };
}

const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);
const pesos = (cents: number) => (cents / 100).toFixed(2);

/** BBVA prints its own totals every statement, so no previous file is needed. */
function reconcile(parsed: BbvaCheckingParsedStatement) {
  const errors: string[] = [];
  const cargoRows = parsed.rows.filter((row) => row.cents < 0);
  const abonoRows = parsed.rows.filter((row) => row.cents > 0);

  const cargoCents = -sum(cargoRows.map((row) => row.cents));
  if (cargoCents !== parsed.totalCargoCents) {
    errors.push(
      `TOTAL IMPORTE CARGOS: rows sum to ${pesos(cargoCents)}, statement says ${pesos(parsed.totalCargoCents)}`,
    );
  }
  if (cargoRows.length !== parsed.cargoCount) {
    errors.push(
      `TOTAL MOVIMIENTOS CARGOS: ${cargoRows.length} row(s), statement says ${parsed.cargoCount}`,
    );
  }

  const abonoCents = sum(abonoRows.map((row) => row.cents));
  if (abonoCents !== parsed.totalAbonoCents) {
    errors.push(
      `TOTAL IMPORTE ABONOS: rows sum to ${pesos(abonoCents)}, statement says ${pesos(parsed.totalAbonoCents)}`,
    );
  }
  if (abonoRows.length !== parsed.abonoCount) {
    errors.push(
      `TOTAL MOVIMIENTOS ABONOS: ${abonoRows.length} row(s), statement says ${parsed.abonoCount}`,
    );
  }

  return errors;
}

/** BBVA's own per-page table header, unique to this statement's layout */
const detect = (text: string) => /Detalle de Movimientos Realizados/.test(text);

const bbvaChecking: Format<BbvaCheckingParsedStatement> = {
  id: "bbva-checking",
  detect,
  parse,
  needsPreviousStatement: false,
  reconcile,
};

export default bbvaChecking;
