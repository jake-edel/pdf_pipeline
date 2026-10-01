/**
 * modelFile.ts — converts a `CategoryModel` to and from the JSON written to
 * model/category_model.json. The model's Maps become plain objects, with
 * keys sorted so the file diffs cleanly between builds and so reading it
 * back always yields the same Map iteration order (which is what
 * `classify()` falls back on to order categories with tied scores).
 */

import type { CategoryModel } from "./buildModel.ts";

type CountsObject = Record<string, number>;

/** The on-disk shape: `CategoryModel` with every Map as a plain object. */
type CategoryModelFile = {
  vocabularySize: number;
  categoryTransactionCounts: CountsObject;
  categoryWordTotals: CountsObject;
  wordCategoryCounts: Record<string, CountsObject>;
};

function sortedObject<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries(
    [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function serializeModel(model: CategoryModel): string {
  const file: CategoryModelFile = {
    vocabularySize: model.vocabularySize,
    categoryTransactionCounts: sortedObject(model.categoryTransactionCounts),
    categoryWordTotals: sortedObject(model.categoryWordTotals),
    wordCategoryCounts: sortedObject(
      new Map(
        [...model.wordCategoryCounts].map(([word, perCategory]) => [
          word,
          sortedObject(perCategory),
        ]),
      ),
    ),
  };
  return JSON.stringify(file, null, 2) + "\n";
}

function isCounts(value: unknown): value is CountsObject {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((n) => typeof n === "number")
  );
}

function isCategoryModelFile(value: unknown): value is CategoryModelFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.vocabularySize === "number" &&
    isCounts(v.categoryTransactionCounts) &&
    isCounts(v.categoryWordTotals) &&
    typeof v.wordCategoryCounts === "object" &&
    v.wordCategoryCounts !== null &&
    Object.values(v.wordCategoryCounts).every(isCounts)
  );
}

export function deserializeModel(text: string): CategoryModel {
  const file: unknown = JSON.parse(text);
  if (!isCategoryModelFile(file)) {
    throw new Error("File is not a category model!");
  }
  return {
    vocabularySize: file.vocabularySize,
    categoryTransactionCounts: new Map(
      Object.entries(file.categoryTransactionCounts),
    ),
    categoryWordTotals: new Map(Object.entries(file.categoryWordTotals)),
    wordCategoryCounts: new Map(
      Object.entries(file.wordCategoryCounts).map(([word, perCategory]) => [
        word,
        new Map(Object.entries(perCategory)),
      ]),
    ),
  };
}
