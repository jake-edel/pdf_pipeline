/**
 * decide.ts — turns a merchant string into an actual category decision.
 * classify()` only ranks possibilities; this is where the winner is picked.
 */
import type { CategoryModel, CategoryPolicy } from "./buildModel.ts";
import { matchPolicy } from "./buildModel.ts";
import { classify } from "./classify.ts";

const CATEGORY_CONFIDENCE_THRESHOLD = 0.5;

/**
 * @param merchant - Same string passed to `classify()`, matched against
 * `category_policy.json` case-insensitively.
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

  // Our vendor => string mappings in the policy file are decision
  // overrides. If we find a match, that dictates the assigned category.
  const policyCategory = matchPolicy(policy, merchant);
  if (policyCategory !== undefined) return policyCategory;

  const classification = classify(merchant, model);
  const [top] = classification;
  if (top !== undefined && top.score > threshold) {
    return top.category;
  }

  return null;
}
