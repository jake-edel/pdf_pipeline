/**
 * buildModel.ts — turns categorized transaction history into a trained
 * `CategoryModel`, the data object `classify()` scores new merchants
 * against.
 *
 * Everything here is COUNTING, not deciding — this module never computes a
 * probability, never picks a winning category, never applies a
 * threshold. It reads every (merchant, category) pair we have evidence
 * for, tokenizes each merchant, and tallies how often each word showed
 * up under each category. That's it. The counts it produces are exactly
 * the ingredients Naive Bayes needs later:
 *
 *   P(word | category) = count(word, category) / categoryWordTotals[category]
 *
 * (with Laplace smoothing added at that division — see the type
 * comments below for where `vocabularySize` fits in). Deliberately NOT
 * computed here: dividing to get an actual probability is `classify()`'s
 * job, done at prediction time. Storing raw counts instead of
 * precomputed probabilities means this module can just keep adding —
 * new history, new policy entries — without ever having to "undo" a
 * division; a probability is a snapshot, a count is durable.
 */

import { isCardPayment } from "../firefly.ts";
import type { Transaction } from "../transaction.ts";
import { tokenize } from "./tokenize.ts";

/** `category_policy.json`, loaded: `{ "merchant": "category" }`. */
export type CategoryPolicy = Record<string, string>;

/**
 * Case-insensitive lookup of `merchant` in the policy. The policy was
 * hand-built against Nu's mostly Title-Case merchant strings, but BBVA's are
 * ALL-CAPS, so an exact-match lookup silently misses rows that are really
 * the same merchant under different casing.
 */
export function matchPolicy(
  policy: CategoryPolicy,
  merchant: string,
): string | undefined {
  const lower = merchant.toLowerCase();
  for (const key of Object.keys(policy)) {
    if (key.toLowerCase() === lower) return policy[key];
  }
  return undefined;
}

/**
 * The trained state `classify()` reads. Everything in here is a raw
 * count — see the module header for why probabilities aren't
 * precomputed.
 */
export type CategoryModel = {
  /**
   * count(word, category) — how many times each word occurred under
   * each category. This is the numerator of P(word | category).
   * A `Map<string, number>` per word (rather than one giant table keyed
   * by `${word}|${category}`) because that's what "for a given word,
   * what does its distribution across categories look like" naturally
   * is, and it's the exact shape `classify()` will want to read from.
   */
  wordCategoryCounts: Map<string, Map<string, number>>;
  /**
   * Total word occurrences per category (summed across every word,
   * counting duplicates within a single merchant string — see
   * tokenize.ts on why duplicates are kept). This is the denominator of
   * P(word | category): "of every word ever seen under this category,
   * what fraction was this one."
   */
  categoryWordTotals: Map<string, number>;
  /**
   * Transaction count per category — not word count, *transaction*
   * count, incremented by a source's weight regardless of how many
   * words it tokenized into. This is the basis for the prior
   * P(category): "how common is this category overall, independent of
   * what words show up."
   */
  categoryTransactionCounts: Map<string, number>;
  /**
   * Count of distinct words across the WHOLE corpus (every category
   * combined) — not per category. Laplace smoothing adds 1 to every
   * word/category count to avoid a single unseen word zeroing out an
   * entire probability product; `vocabularySize` is the matching
   * addition to the denominator, so the smoothed probabilities across
   * all categories for a given word still sum to something coherent.
   * It's a single number rather than a per-category one because the
   * vocabulary — the set of words that *could* appear — doesn't depend
   * on which category you're asking about.
   */
  vocabularySize: number;
};

function ingest(
  merchant: string,
  category: string,
  wordCategoryCounts: Map<string, Map<string, number>>,
  categoryWordTotals: Map<string, number>,
  categoryTransactionCounts: Map<string, number>,
) {
  const weight = 1;

  categoryTransactionCounts.set(
    category,
    (categoryTransactionCounts.get(category) ?? 0) + weight,
  );

  for (const word of tokenize(merchant)) {
    const perCategory = wordCategoryCounts.get(word) ?? new Map<string, number>();
    perCategory.set(category, (perCategory.get(category) ?? 0) + weight);
    wordCategoryCounts.set(word, perCategory);

    categoryWordTotals.set(category, (categoryWordTotals.get(category) ?? 0) + weight);
  }
}

/**
 * Builds a `CategoryModel` from categorized history plus a hand-authored
 * category policy. Pure and stateless by design: nothing here reads or
 * writes a file, and nothing about the result depends on anything but
 * its two arguments. That's a deliberate simplicity choice from
 * notes/category-engine-design.md — at a few hundred transactions,
 * rebuilding the model from scratch on every run is cheap, and a model
 * that's always freshly derived from its two sources can never drift
 * out of sync with them the way a persisted, incrementally-updated one
 * could.
 *
 * @param history - Every `Transaction` we have, from every month's
 * `transactions/*.json`. Most of it gets filtered out before it
 * contributes a single count:
 *   - `category_name === null` rows (every new-format transaction,
 *     since that's the whole problem this engine exists to solve) carry
 *     no training signal and are skipped — unless the policy has a
 *     (case-insensitive) match for their `opposing_name`, in which
 *     case they count under that category like any other row.
 *   - Card payment rows are skipped via the same `isCardPayment` check
 *     `jsonToCsv.ts` uses to leave them out of the Firefly CSV. This
 *     matters concretely, not just in theory: a real row in the data is
 *     `"Pago a tu tarjeta de crédito"` with `category_name` literally
 *     `"¡Muchas gracias!"` — the bank's payment-receipt line, not a
 *     spending category. Without this filter, "GRACIAS" becomes a
 *     learned word under a fake category that will never appear again.
 * @param policy
 */
export function buildModel(
  history: Transaction[],
  policy: CategoryPolicy,
): CategoryModel {
  const wordCategoryCounts = new Map<string, Map<string, number>>();
  const categoryWordTotals = new Map<string, number>();
  const categoryTransactionCounts = new Map<string, number>();

  for (const transaction of history) {
    if (isCardPayment(transaction)) continue;

    // If the policy has a (case-insensitive) match for our merchant, it's a
    // category override — replace the category with the one from the policy.
    const policyCategory = matchPolicy(policy, transaction.opposing_name);
    const category = policyCategory ?? transaction.category_name;

    // No override and no bank-printed category: nothing to learn from
    if (category === null) continue;

    ingest(
      transaction.opposing_name,
      category,
      wordCategoryCounts,
      categoryWordTotals,
      categoryTransactionCounts,
    );
  }

  const vocabularySize = wordCategoryCounts.size;

  return {
    wordCategoryCounts,
    categoryWordTotals,
    categoryTransactionCounts,
    vocabularySize,
  };
}
