/**
 * tokenize.ts — turns a raw merchant string into a bag of words.
 *
 * This is the foundation of the category engine described in
 * CATEGORY_ENGINE.md: a Naive Bayes classifier that predicts a
 * `category_name` for new-format transactions (which arrive with
 * `category_name: null`), trained on old-format transactions (which
 * carry a real category printed by the bank).
 *
 * Naive Bayes doesn't look at merchant strings — it looks at *words*.
 * It learns things like "the word FERRETERIA has appeared 14 times in
 * the training data, always under the category Hogar", and later, when
 * it sees a brand-new merchant string it's never encountered, it scores
 * each candidate category by multiplying together how well each of the
 * string's words has predicted that category historically. This module
 * is the thing that turns a string into that list of words in the first
 * place. Get this step wrong and the classifier trains on noise no
 * matter how correct its math is downstream.
 *
 * THE ONE RULE THAT MATTERS MORE THAN ANYTHING ELSE IN THIS FILE:
 * this exact function must be called both when building the model
 * (walking historical transactions to count word/category co-occurrences)
 * and when classifying a new merchant string (turning it into words to
 * score against that model). If the two ever tokenize differently — say,
 * someone "fixes" a bug here but only updates callers on one side — the
 * model doesn't crash. It just quietly gets worse, forever, because
 * training-time words and prediction-time words stop lining up. There's
 * no test that catches that by accident; it has to be structural. Which
 * is why this is a single pure function with no branches based on
 * "am I training or predicting right now" — there is no such concept
 * here, only "turn this string into words," full stop.
 */

/**
 * `tokenize` normalizes and splits a merchant string into word tokens.
 *
 * The pipeline, in order, and why each step exists:
 *
 * 1. UNICODE-NORMALIZE AND STRIP ACCENTS.
 *    Spanish text mixes accented and unaccented spellings of the same
 *    word depending on who typed it into the bank's system ("crédito"
 *    vs "credito"). Without this step those are two unrelated words to
 *    the model, each with half the evidence it should have. We convert
 *    to Unicode's NFD ("decomposed") form, which rewrites a character
 *    like "é" as the plain letter "e" followed by a separate combining
 *    accent mark, then strip anything in the combining-marks range.
 *    That leaves plain ASCII letters with the accent simply gone.
 *
 * 2. CASE-FOLD (uppercase everything).
 *    "Oxxo", "OXXO", and "oxxo" are the same merchant. The historical
 *    data is inconsistently cased (old-format merchants tend to be
 *    Title Case, e.g. "Costco Cancun"), so without this every category
 *    would need to see every casing variant separately to learn it.
 *
 * 3 & 4. SPLIT INTO RUNS OF LETTERS AND RUNS OF DIGITS, THEN DISCARD
 *    THE DIGIT RUNS. This is really two ideas that turn out to be one
 *    regex:
 *
 *    a) Anything that isn't a letter or a digit is a separator. This
 *       matters more than it sounds, because real merchant strings glue
 *       payment-processor prefixes onto the actual vendor name with an
 *       asterisk and no space — "Str*Amazon", "Clip Mx*Rest El Comal",
 *       "Wl *Steam Purchase". A naive `.split(" ")` leaves "STR*AMAZON"
 *       as a single, never-repeating token that teaches the model
 *       nothing and can never match anything at prediction time either.
 *       Splitting on any non-alphanumeric character (not just
 *       whitespace) recovers "STR" and "AMAZON" as separate words, and
 *       AMAZON is the one that actually carries signal — it'll recur
 *       across "Stripe *Amazon", "Amazon A Meses - 2/3", and so on.
 *
 *    b) Store/branch numbers get glued directly onto words with *no*
 *       separator at all — "Velamar199" (a Chedraui branch), "Mx0011"
 *       (an H&M store code). These aren't separated by punctuation, so
 *       step (a) alone wouldn't split them; we additionally split at
 *       the boundary between a run of letters and a run of digits.
 *       Once split, the digit run ("199", "0011") is discarded — it's
 *       a branch identifier, not a signal about what kind of merchant
 *       this is, and keeping it would fragment the same real-world
 *       vendor into a different "word" per store location.
 *
 *       This also quietly handles installment suffixes like the "2/3"
 *       in "Amazon A Meses - 2/3" — the "/" is already a separator per
 *       (a), and the bare digits "2" and "3" it leaves behind get
 *       dropped by this same digit-discarding step. No separate regex
 *       for installment counters is needed; it falls out for free.
 *
 * The result is an array of uppercase, accent-free, digit-free word
 * tokens, in the order they appeared, WITH DUPLICATES KEPT (if a
 * merchant string repeats a word twice — "Oxxo Oxxo Del Carmen" is a
 * real one — that word counts twice when the model tallies word
 * occurrences per category; word order itself is later thrown away by
 * the classifier, since Naive Bayes treats a merchant string as an
 * unordered bag of words, not a sequence).
 *
 * WHAT THIS FUNCTION DELIBERATELY DOES NOT DO, AND WHY:
 *
 * - It does not strip Spanish stopwords ("la", "de", "el", "y", "a").
 *   These words show up across every category roughly equally, so
 *   Naive Bayes already discounts them on its own — a word that's
 *   equally likely under every category multiplies every category's
 *   score by roughly the same factor, so it barely moves the ranking.
 *   A hand-maintained stopword list is one more thing to keep in sync
 *   for a problem the math already handles.
 *
 * - It does not strip known payment-processor prefixes ("STR",
 *   "STRIPE", "CLIP MX", "WL", "OPLINEA"). Same reasoning: these are
 *   noisy but not *misleading* — they don't point toward a wrong
 *   category, they just add a low-information word that shows up
 *   everywhere and therefore doesn't swing any category's score.
 *
 * - It does not produce multi-word tokens ("bigrams" like
 *   "COSTCO_CANCUN"). CATEGORY_ENGINE.md already considered and
 *   deferred fuzzy string matching for the same reason: a single
 *   strong unigram like COSTCO is already a near-exclusive signal for
 *   its category on its own, so pairing it with a neighboring word
 *   before it's ever been seen paired that way buys nothing.
 *
 * These are all "simplest thing that could work" calls, not settled
 * conclusions — worth revisiting only if real classifier output shows
 * they're actually hurting (e.g. if Undecided rates stay stubbornly
 * high and a look at the scores shows stopwords are the reason).
 *
 * @example
 * tokenize("Str*Amazon")               // ["STR", "AMAZON"]
 * tokenize("Chedraui Pc Velamar199")   // ["CHEDRAUI", "PC", "VELAMAR"]
 * tokenize("Café Nader Huayacan")      // ["CAFE", "NADER", "HUAYACAN"]
 * tokenize("Amazon A Meses - 2/3")     // ["AMAZON", "A", "MESES"]
 * tokenize("Oxxo Oxxo Del Carmen")     // ["OXXO", "OXXO", "DEL", "CARMEN"]
 * tokenize("123")                      // [] — an all-digit string has no words
 */
export function tokenize(merchant: string): string[] {
  const withoutAccents = merchant
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  const upper = withoutAccents.toUpperCase();

  // Match runs of letters OR runs of digits; everything else (spaces,
  // "*", "-", "/", ".", etc.) is implicitly a separator because it
  // matches neither alternative. This single regex does both the
  // "split on punctuation" and "split at the letters/digits boundary"
  // jobs described above in one pass.
  const runs = upper.match(/[A-Z]+|[0-9]+/g) ?? [];

  // Digit-only runs are branch/store codes, not words — drop them.
  return runs.filter((run) => /[A-Z]/.test(run));
}
