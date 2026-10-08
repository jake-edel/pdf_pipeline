import type { Row } from "../parse.ts";

export type ParsedStatement = {
  rows: Row[];
  failed: string[];
};

/**
 * A statement format: owns detection, parsing and reconciliation together,
 * Each statement type which implements this should be able to be consumed
 * by the pipeline.
 */
export type Format<T extends ParsedStatement = ParsedStatement> = {
  /** Printed in logs; not used for namespacing (yet) */
  id: string;
  detect(text: string): boolean;
  parse(text: string): T;
  /** Whether reconcile() needs the previous month's statement text to do its check */
  needsPreviousStatement: boolean;
  /** @param previousText - previous month's statement text, or null if unavailable/not needed */
  reconcile(parsed: T, previousText: string | null): string[];
};
