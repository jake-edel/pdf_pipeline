/**
 * classify.ts — scores a merchant string against a trained `CategoryModel`
 * and ranks every known category by how well it explains the words in that
 * string. This is the Naive Bayes half of the design in
 * notes/category-engine-design.md (§3.2): it doesn't learn anything (that's
 * `buildModel()`) and it doesn't decide anything (that's `decide()`, which
 * layers the policy exact-match and confidence threshold on top of this).
 * Pure and stateless — same merchant + same model always yields the same
 * ranking.
 */

import type { CategoryModel } from "./buildModel.ts";
import { tokenize } from "./tokenize.ts";

/** One category's score for a merchant, as a normalized posterior — see
 * below for why this is a real probability rather than a raw log-score. */
export type RankedCategory = { category: string; score: number };

/**
 * `classify` ranks every category the model knows about against `merchant`,
 * highest-scoring first, so a caller can just read `result[0]`.
 *
 * The math, in log-space (§6 of the design doc — summing logs instead of
 * multiplying probabilities avoids underflow):
 *
 *   logScore(category) = log P(category) + Σ log P(word | category)
 *
 * `P(category)` is the prior: how common that category is overall,
 * regardless of words. `P(word | category)` is Laplace-smoothed so an
 * unfamiliar word gets a small nonzero probability instead of zeroing out
 * the whole product — `(count + 1) / (categoryWordTotal + vocabularySize)`.
 * A word absent for this category, and a word absent from the whole
 * vocabulary, both fall out of that same `?? 0` lookup; either way it
 * contributes the same smoothed value to every category and so doesn't
 * tilt the ranking (by design — see tokenize.ts's header on stopwords for
 * the same reasoning applied to word choice instead of word rarity).
 *
 * The log-summed scores aren't comparable across merchants on their own —
 * a merchant that tokenizes into more words picks up more (negative) terms
 * in the sum, so its scores sit on a different scale than a shorter
 * merchant's. To keep `decide()` simple (one fixed threshold, comparable
 * across every merchant it sees), this function converts the per-category
 * log-scores back into an actual 0..1 posterior before returning, via a
 * softmax: exponentiate each log-score relative to the max (for numerical
 * stability — subtracting the max before `exp` keeps every exponent ≤ 0,
 * so nothing overflows) and divide by the total. The returned scores sum
 * to 1 across all categories.
 */
export function classify(merchant: string, model: CategoryModel): RankedCategory[] {
  const words = tokenize(merchant);
  const categories = [...model.categoryTransactionCounts.keys()];

  let totalTransactions = 0;
  for (const count of model.categoryTransactionCounts.values()) {
    totalTransactions += count;
  }

  const logScores = categories.map((category) => {
    const categoryCount = model.categoryTransactionCounts.get(category) ?? 0;
    const categoryWordTotal = model.categoryWordTotals.get(category) ?? 0;
    const smoothingDenominator = categoryWordTotal + model.vocabularySize;

    let logScore = Math.log(categoryCount / totalTransactions);
    for (const word of words) {
      const wordCount = model.wordCategoryCounts.get(word)?.get(category) ?? 0;
      logScore += Math.log((wordCount + 1) / smoothingDenominator);
    }

    return { category, logScore };
  });

  const maxLogScore = Math.max(...logScores.map((s) => s.logScore));
  const weights = logScores.map((s) => Math.exp(s.logScore - maxLogScore));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  return logScores
    .map((s, i) => ({ category: s.category, score: weights[i] / totalWeight }))
    .sort((a, b) => b.score - a.score);
}
