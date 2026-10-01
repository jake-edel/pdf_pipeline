/**
 * decide.ts — turns a merchant string into an actual category decision,
 * per §4/§5 of notes/category-engine-design.md. `classify()` only ranks
 * possibilities; this is the one place that picks a winner (or refuses to).
 */

import { normalizePolicyEntry } from "./buildModel.ts";
import type { CategoryModel, CategoryPolicy } from "./buildModel.ts";
import { classify } from "./classify.ts";

// Provisional — not yet tuned against real Undecided output. See the "left
// open" list in notes/category-engine-design.md.
const CATEGORY_CONFIDENCE_THRESHOLD = 0.5;

/**
 * @param merchant - Same string passed to `classify()`, and the exact key
 * `category_policy.json` is matched against verbatim.
 * @param model - The weighted model of all the previous known
 * merchant => category mappings
 * @param policy - The category_policy.json read into memory
 * @returns The decided category, or `null` if neither check resolves one.
 */
export function decide(
  merchant: string,
  model: CategoryModel,
  policy: CategoryPolicy,
  threshold: number = CATEGORY_CONFIDENCE_THRESHOLD,
): string | null {
  const policyEntry = policy[merchant];

  // Our vendor => string mappings in the policy file
  // are decision overrides. If we find an exact match,
  // that will dictate the assigned category.
  if (typeof policyEntry === "string") return policyEntry;

  if (policyEntry !== undefined) {
    return normalizePolicyEntry(policyEntry).category;
  }

  const [top] = classify(merchant, model);
  if (top !== undefined && top.score > threshold) {
    return top.category;
  }

  return null;
}
