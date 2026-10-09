import type { Format, ParsedStatement } from "./types.ts";

// TODO: whatever BBVA prints as its own totals (Saldo Anterior, Total de
// Cargos/Abonos, Saldo Final) for reconcile() to check the parsed rows
// against — shape still unknown until the real rows are parsed.
type BbvaCheckingParsedStatement = ParsedStatement;

function parse(_text: string): BbvaCheckingParsedStatement {
  throw new Error("bbvaChecking.parse: not implemented yet");
}

function reconcile(_parsed: BbvaCheckingParsedStatement): string[] {
  throw new Error("bbvaChecking.reconcile: not implemented yet");
}

/** BBVA's own per-page table header, unique to this statement's layout */
const detect = (text: string) => /Detalle de Movimientos Realizados/.test(text);

const bbvaChecking: Format<BbvaCheckingParsedStatement> = {
  id: "bbva-checking",
  detect,
  parse,
  // BBVA prints its own Saldo Anterior/Saldo Final on every statement, so
  // reconcile() shouldn't need the previous month's file the way old Nu does.
  needsPreviousStatement: false,
  reconcile,
};

export default bbvaChecking;
