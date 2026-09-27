/**
 * decide.ts — turns a merchant string into an actual category decision,
 * per §4/§5 of notes/category-engine-design.md. `classify()` only ranks
 * possibilities; this is the one place that picks a winner (or refuses to).
 *
 * Two checks, in order:
 *
 * 1. POLICY EXACT MATCH. `category_policy.json` is looked up directly by
 *    exact key — no `tokenize()` — before `classify()` is even called. A
 *    hit here wins outright, regardless of what the classifier would have
 *    guessed or how confident it is. This is what makes a hand-authored
 *    policy entry "stick" the moment it's added (the same file also feeds
 *    `buildModel()` as training data — see that module's header — this is
 *    its second, independent use).
 * 2. CLASSIFIER ABOVE THRESHOLD. Otherwise, `classify()`'s top-ranked
 *    category wins, but only if its score clears `threshold`. Below that,
 *    the result is `null` ("Undecided" downstream) rather than a
 *    low-confidence guess — a wrong category silently exported is more
 *    work to catch later than a visibly unresolved row (§3.3).
 */

import { normalizePolicyEntry } from "./buildModel.ts";
import type { CategoryModel, CategoryPolicy } from "./buildModel.ts";
import { classify } from "./classify.ts";

/**
 * @param merchant - Same string passed to `classify()`, and the exact key
 * `category_policy.json` is matched against verbatim (no tokenizing).
 * @param threshold - Minimum classifier score (0..1) to accept the
 * top-ranked category. Not yet tuned — see the design doc's "left open"
 * list.
 * @returns The decided category, or `null` if neither check resolves one.
 */
export function decide(
  merchant: string,
  model: CategoryModel,
  policy: CategoryPolicy,
  threshold: number,
): string | null {
  const policyEntry = policy[merchant];
  if (policyEntry !== undefined) {
    return normalizePolicyEntry(policyEntry).category;
  }

  const [top] = classify(merchant, model);
  if (top !== undefined && top.score > threshold) {
    return top.category;
  }

  return null;
}
