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
 *
 * TWO SOURCES FEED THE SAME COUNTS.
 *
 * 1. HISTORY — old-format `Transaction[]` rows, which carry a real
 *    `category_name` printed by the bank. This is "free" training data;
 *    nobody had to sit down and label it. Each row counts as one
 *    transaction's worth of evidence (weight 1).
 *
 * 2. CATEGORY POLICY — a small hand-authored file (`category_policy.json`
 *    in the design doc) mapping a merchant string OR a bare word to a
 *    category, with an optional weight. It serves two purposes under one
 *    schema:
 *      - A plain string value is a ROW-LEVEL CORRECTION — "this specific
 *        merchant string was mislabeled (or is `Undecided`), it should
 *        be this category instead." Counts as one synthetic transaction,
 *        same weight as a real history row.
 *      - An object value with an explicit `weight` is a CATEGORY-LEVEL
 *        DECLARATION — "this word should define its own category, or
 *        overwhelmingly override whatever history currently associates
 *        it with, going forward." Counts as `weight` synthetic
 *        transactions, chosen large enough to outweigh (not necessarily
 *        erase — see below) whatever competing evidence already exists.
 *        This is also how a category that doesn't exist anywhere in
 *        history (e.g. `Ferreteria`, if hardware stores currently fall
 *        under `Hogar` or `Electrónicos`) gets created: naming it in a
 *        policy entry is the only "registration" a category needs, since
 *        every count this module produces — word counts AND the
 *        `categoryTransactionCounts` prior — comes from `ingest()` calls,
 *        and `ingest()` doesn't care whether the category has been seen
 *        before.
 *
 * Both sources are tokenized by the exact same `tokenize()` used at
 * prediction time (see that file's header for why that symmetry is the
 * single most important invariant in the whole engine) and folded into
 * the same counts via the same `ingest()` helper. `classify()` never
 * knows or cares whether a given word's evidence came from the bank or
 * from a human — by the time it reads the model, it's all just numbers.
 *
 * A WORD-LEVEL CAVEAT WORTH RECORDING HERE: `ingest()` tokenizes
 * whatever key you give it and applies the SAME weight to every
 * resulting word independently — there is no way to weight a *phrase* as
 * a unit, because Naive Bayes doesn't represent word pairs at all (§3.2
 * of the design doc — "naive" means exactly this). Seeding the policy
 * key `"Home Depot"` at weight 30 doesn't create one signal, it creates
 * two: `HOME` and `DEPOT` each independently become strong `Ferreteria`
 * evidence, and either one alone would now pull some unrelated future
 * merchant containing just that word toward `Ferreteria` too. Usually
 * harmless (loanwords like `HOME`/`DEPOT` don't otherwise appear in this
 * Spanish-language corpus), but the mitigation when a constituent word
 * IS generic is to key the entry on the most distinctive single word
 * (`"Depot"`) rather than the full merchant string — no code change
 * needed, just a more deliberate choice of key.
 *
 */

import { isCardPayment } from "../firefly.ts";
import type { Transaction } from "../transaction.ts";
import { tokenize } from "./tokenize.ts";

/**
 * One entry in the category policy file. Either shape is keyed the same
 * way — a merchant string for a row fix, or a bare word/short phrase for
 * a category declaration — and matching against history (for the
 * "corrections win" exclusion below) is a plain string comparison
 * against `opposing_name` rather than going through `tokenize()`, so a
 * row-level correction should be copy-pasted verbatim from the
 * transaction JSON it's meant to fix. A category-level declaration's key
 * is chosen deliberately rather than copied — see the module header's
 * word-level caveat for why that choice matters.
 *
 * - `string` — a plain category name. Implicit weight of 1: this entry
 *   is worth exactly one synthetic transaction, the same as a single
 *   real history row. This is the row-level correction case.
 * - `{ category, weight }` — an explicit weight. This entry is worth
 *   `weight` synthetic transactions, chosen large enough to dominate
 *   whatever it's competing against. This is the category-level
 *   declaration case, including bringing a brand-new category into
 *   existence outright.
 */
export type CategoryPolicyEntry = string | { category: string; weight: number };

/** `category_policy.json`, loaded: `{ "key": CategoryPolicyEntry }`. */
export type CategoryPolicy = Record<string, CategoryPolicyEntry>;

function normalizePolicyEntry(entry: CategoryPolicyEntry): {
  category: string;
  weight: number;
} {
  return typeof entry === "string" ? { category: entry, weight: 1 } : entry;
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

/**
 * Folds one (key, category) pair into the counts being built, worth
 * `weight` synthetic transactions (default 1, i.e. one real transaction
 * or one plain-string policy correction). Called once per history row
 * and once per policy entry — every source ends up going through the
 * same accounting, which is exactly the point (see module header).
 */
function ingest(
  merchant: string,
  category: string,
  wordCategoryCounts: Map<string, Map<string, number>>,
  categoryWordTotals: Map<string, number>,
  categoryTransactionCounts: Map<string, number>,
  weight = 1,
) {
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
 *     no training signal and are skipped.
 *   - Card payment rows are skipped via the same `isCardPayment` check
 *     `jsonToCsv.ts` uses to leave them out of the Firefly CSV. This
 *     matters concretely, not just in theory: a real row in the data is
 *     `"Pago a tu tarjeta de crédito"` with `category_name` literally
 *     `"¡Muchas gracias!"` — the bank's payment-receipt line, not a
 *     spending category. Without this filter, "GRACIAS" becomes a
 *     learned word under a fake category that will never appear again.
 *   - Any row whose `opposing_name` is a key in `policy` is skipped,
 *     even though it otherwise has a usable `category_name`. This is the
 *     "policy wins" rule: if a human has explicitly relabeled a
 *     merchant, every historical occurrence of that exact string defers
 *     to the policy entry rather than contributing its (possibly wrong,
 *     or no longer wanted) original label. A merchant that appears
 *     correctly 20 times in history and is corrected once ends up
 *     contributing ONE data point under the corrected category, not 20
 *     old ones plus 1 new one pulling in different directions. Note this
 *     only ever fires for full-merchant-string keys — a category
 *     declaration keyed on a bare word (`"Depot"`) never matches a real
 *     `opposing_name` exactly, so it leaves history's counts in place and
 *     wins by outweighing them instead, which is the intended behavior
 *     for that case (see module header).
 * @param policy - The category policy: a mix of row-level corrections
 * (plain string values, weight 1) and category-level declarations
 * (object values with an explicit `weight`). See `CategoryPolicy` above.
 * Every entry here always contributes to the counts — there's no
 * filtering to do, since a human already decided each one on purpose.
 */
export function buildModel(
  history: Transaction[],
  policy: CategoryPolicy,
): CategoryModel {
  const wordCategoryCounts = new Map<string, Map<string, number>>();
  const categoryWordTotals = new Map<string, number>();
  const categoryTransactionCounts = new Map<string, number>();

  const policyMerchants = new Set(Object.keys(policy));

  for (const transaction of history) {
    if (transaction.category_name === null) continue;
    if (isCardPayment(transaction)) continue;
    if (policyMerchants.has(transaction.opposing_name)) continue;

    ingest(
      transaction.opposing_name,
      transaction.category_name,
      wordCategoryCounts,
      categoryWordTotals,
      categoryTransactionCounts,
    );
  }

  for (const [key, entry] of Object.entries(policy)) {
    const { category, weight } = normalizePolicyEntry(entry);

    ingest(
      key,
      category,
      wordCategoryCounts,
      categoryWordTotals,
      categoryTransactionCounts,
      weight,
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
