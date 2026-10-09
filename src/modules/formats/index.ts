import nuOldFormat from "./nuOldFormat.ts";
import nuNewFormat from "./nuNewFormat.ts";
import bbvaChecking from "./bbvaChecking.ts";
import type { Format } from "./types.ts";

/** Tried in order; adding a format is adding an entry here. */
const formats: Format<any>[] = [nuOldFormat, nuNewFormat, bbvaChecking];

/** Picks the one format whose `detect()` matches. Zero or several matches is an error. */
export default function detectFormat(text: string): Format<any> {
  const matches = formats.filter((format) => format.detect(text));

  if (matches.length === 0) {
    throw new Error("No format matched this statement");
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple formats matched this statement: ${matches.map((f) => f.id).join(", ")}`,
    );
  }

  return matches[0];
}
