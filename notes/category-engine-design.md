# Category Engine — Design Notes

This document explains the problem, the techniques under consideration, and the
proposed architecture for automatically assigning a `category_name` to
transactions that don't come with one. It's written for someone who hasn't
worked with statistical/ML classifiers before — the goal is to actually
understand *why* this works, not just copy a formula.

## 1. Overview

Old-format statements (Jun 2025 – Mar 2026) include a category printed by the
bank (`Viajes`, `Hogar`, `Supermercado`, …). New-format statements (Apr 2026
onward) don't — every `category_name` in those JSON files is `null`. Firefly
III still wants a category per transaction, and hand-assigning a couple dozen
categories every month is exactly the kind of repetitive manual work worth
automating, as long as it doesn't require blind trust — a wrong category is
low-stakes (easy to fix later), but silently wrong for months is annoying.

So the goal is: given a merchant string with no category (e.g.
`"Costco Cancun"`), predict the most likely category (`Hogar`), using nothing
but the categorized history we already have from the old-format months —
without demanding an exact match to something seen before.

## 2. The problem, concretely

If you just built a lookup table of `merchant string → category` from history,
it would miss almost every new-format row, because merchant strings vary in
small ways even for the same real-world vendor:

- `Amazon A Meses - 2/3` vs. `Amazon A Meses - 2/12` — same vendor, different
  installment counter.
- `Costco Cancun` vs. a hypothetical `Costco Cuernavaca` — same vendor,
  different branch/city suffix.

An exact-string map only ever answers "have I seen *this exact string*
before?" We want something closer to "have I seen enough evidence to guess
what kind of merchant this is?"

(This is the reasoning that motivated moving past exact matching to the
classifier below. The exact-match idea itself didn't disappear — it
survives in narrowed form as part of the category policy file in §5,
which is a better fit for it than a table built from all of history. See
§4/§5 for what actually shipped.)

Real numbers from the current history (`transactions/*.json`, old-format
rows only, since those are the ones with a category today):

| category     | transactions seen |
| ------------ | ----------------- |
| Servicio     | 54                |
| Supermercado | 35                |
| Restaurante  | 33                |
| Hogar        | 31                |
| Transporte   | 22                |
| Salud        | 20                |
| Otros        | 16                |
| Ocio         | 11                |

And a few words already show a strong, one-sided association with a category:

| word         | category it's been seen with | count |
| ------------ | ---------------------------- | ----- |
| `OXXO`       | Supermercado                 | 11    |
| `FERRETERIA` | Hogar                        | 14    |
| `COSTCO`     | Hogar                        | 8     |
| `AEROBUS`    | Viajes                       | 1     |

That last table is the key insight the whole design leans on: **individual
words in a merchant string are informative on their own**, even when the full
string has never been seen before.

## 3. Techniques

### 3.1 Baseline: normalized exact-match lookup

Build a map from every historically-known merchant string to its category.
Before comparing, normalize both sides a bit (uppercase, strip installment
suffixes like `- N/M`, strip trailing digits) so `Amazon A Meses - 2/3` and
`Amazon A Meses - 2/12` collapse to the same key. This is free, fast, and
exact — no false positives — but it only ever handles merchants you've
literally seen before (modulo the normalization). It's the first thing to try
because when it hits, it's never wrong.

### 3.2 Statistical classifier: Naive Bayes

This is the part that generalizes to brand-new merchant strings. It answers:
"given the words in this merchant name, and everything I've seen before, what
category is statistically most likely?"

**Bayes' theorem**, in plain language: the probability of a category being
correct, given the words you see, is proportional to two things multiplied
together — how often those words have shown up in that category before, and
how common that category is overall.

```
P(category | words) ∝ P(category) × P(words | category)
```

**"Naive"** refers to a simplifying assumption: treat each word in the
merchant string as independent of the others, and multiply their individual
probabilities together, ignoring word order or word-to-word correlation.
That's not literally true of language, but for short strings like merchant
names (2–4 words), it works well in practice — this is the same basic
technique behind classic spam filters, applied to a much smaller, cleaner
problem.

**Training** (done once, from history): for every category, count how often
each word appears in merchant strings labeled with that category. `FERRETERIA`
appeared 14 times, always under `Hogar` → `P("FERRETERIA" | Hogar)` comes out
high, and `P("FERRETERIA" | any other category)` comes out near zero.

**Prediction** (done per new merchant): split the string into words. For each
candidate category, multiply `P(word | category)` for every word in the
string, times `P(category)` (the category's overall frequency — a mild prior
towards common categories like `Servicio`). Whichever category scores highest
wins. Example: `"Ferreteria Hidalgo Chetumal"` has never been seen as a full
string, but it contains `FERRETERIA`, which is a strong, almost exclusive
signal for `Hogar` — so the classifier gets it right despite zero string
overlap with any known example.

**A wrinkle — unseen words:** if a word never appeared in training at all, its
raw probability is 0, which would zero out the entire product no matter what
the other words say. The standard fix, **Laplace (add-one) smoothing**, adds 1
to every count before computing probabilities, so an unfamiliar word gets a
small nonzero probability instead of vetoing the whole prediction.

**The score doubles as a confidence number.** A merchant with a strongly
diagnostic word (`FERRETERIA`) scores very high for one category and low
everywhere else — high confidence. A merchant made only of generic or
ambiguous words scores similarly across several categories — low confidence.
That confidence is what the next section uses to decide whether to trust the
guess.

### 3.3 Confidence threshold, and an explicit "Undecided" category

Rather than always forcing a guess, pick a probability threshold. Above it,
apply the predicted category automatically. Below it, output an explicit
`Undecided` (or `null`) category instead of a low-confidence guess. This
avoids silently mis-categorizing ambiguous rows — false labels are more work
to catch later than a visible "I don't know," and `Undecided` transactions in
the CSV are trivially easy to filter for by hand.

There's no separate interactive prompt in this design. A couple dozen
transactions a month is little enough to review by eye, so unresolved rows
just get fixed by hand-editing a small JSON file (see §5) and are picked up
automatically the next time the model is rebuilt.

### 3.4 Techniques considered and deferred

- **Fuzzy string matching** (edit distance / token overlap between the new
  merchant and known ones) was an earlier idea for handling near-duplicates
  like `Costco Cancun` vs. `Costco Cuernavaca`. The Naive Bayes classifier
  already handles this case for free — `COSTCO` alone is a strong word-level
  signal regardless of what city follows it — so a separate fuzzy-matching
  component would mostly duplicate what the classifier already does, for
  more code to maintain. Worth revisiting only if the classifier's confidence
  turns out to be too spread out in practice.
- **TF-IDF weighting** (down-weighting common words, up-weighting rare ones
  when scoring similarity) matters more for longer text and larger
  vocabularies. With ~190 distinct merchants and 2–4-word strings, plain
  word-presence counts already capture most of the signal; TF-IDF would add
  complexity without a demonstrated need.
- **Hand-written regex rules per merchant family** are fragile (they only
  cover patterns you thought to anticipate) and the classifier subsumes most
  of their value by learning word/category associations automatically instead
  of requiring them to be authored by hand.
- **An LLM call per transaction** would likely work well too, but adds an
  external dependency, latency, and (mild) privacy exposure for financial
  data, for a problem a few hundred bytes of local statistics already solves.
- **An interactive CLI prompt** was the original design for handling
  uncertain rows, but was dropped in favor of batch hand-curation of a JSON
  file (§5) — same human-in-the-loop principle, without needing a live
  prompt loop.

## 4. Architecture

```
┌───────────────────────────────┐   ┌───────────────────────────────┐
│ transactions/*.json history   │   │ category_policy.json         │
│ (old-format rows: real        │   │ (hand-authored: merchant/word│
│  category_name from the bank) │   │  → category, + optional      │
└───────────────┬───────────────┘   │  weight — row corrections at │
                │                   │  weight 1, category          │
                │                   │  declarations at higher      │
                │                   │  weight; see §5)             │
                │                   └───────────────┬──────────────┘
                └───────────────┬───────────────────┘
                                 ▼
                        ┌───────────────────┐
                        │   tokenize()      │  shared normalizer — same
                        │  (pure function)  │  function used at training
                        └────────┬──────────┘  time AND prediction time
                                 ▼
                        ┌─────────────────────┐
                        │   buildModel()      │  walks the combined corpus,
                        │                     │  produces a CategoryModel
                        └────────┬────────────┘
                                 ▼
                        ┌─────────────────────┐
                        │   CategoryModel     │  trained state (see §5
                        │   (data object)     │  for the exact shape)
                        └────────┬────────────┘
                                 │
          new merchant string ─ ─┼── tokenize() ──► ┌─────────────────────┐
                                 │                  │   classify()        │
                                 │                  └────────┬────────────┘
                                 │                           ▼
                                 │                  ranked [{category, score}]
                                 │                           ▼
                                 │                  ┌─────────────────────┐
                                 └─────────────────►│   decide()          │
                                                    └────────┬────────────┘
                                   policy exact match? ──────┤
                                   else: top score            ▼
                                   > threshold?            category, OR "Undecided"
```

`category_policy.json` is consulted twice, for two different reasons: it
flows into `buildModel()` as training data (same as history, both feed
the same counts), and separately, `decide()` reads it directly as a
plain exact-key lookup — no tokenizing — before ever calling
`classify()`. That second path is what makes a hand-written policy entry
take effect deterministically the moment it's added, rather than merely
nudging the classifier's odds. See §5 for why.

**Modules:**

- **`tokenize.ts`** — pure function, `(merchant: string) => string[]`.
  Uppercases, strips punctuation/digits/installment suffixes, splits on
  whitespace. Used identically at training and prediction time — if these
  ever drift apart, the model silently degrades.
- **`buildModel.ts`** — `(history, policy) => CategoryModel`. Recomputed
  from scratch each run (no need to persist the model itself — it's cheap to
  rebuild at this data volume, and staying stateless keeps it always
  consistent with the source files). Every policy entry contributes at
  least one synthetic transaction's worth of evidence — weight 1 for a
  plain row correction, or an explicit higher weight for a category
  declaration (see §5).
- **`classify.ts`** — `(merchant: string, model: CategoryModel) =>
  RankedCategory[]`. Pure, no I/O, easy to unit test against known examples
  (e.g. assert `"Ferreteria Hidalgo Chetumal"` scores highest for `Hogar`).
- **`decide.ts`** — checks `category_policy.json` for an exact key match
  first (no tokenizing), then falls back to classifier-above-threshold,
  then `Undecided`.

**Data objects:**

```ts
type CategoryModel = {
  // count(word, category) — numerator of P(word | category)
  wordCategoryCounts: Map<string, Map<string, number>>;
  // total word occurrences per category — denominator of P(word | category)
  categoryWordTotals: Map<string, number>;
  // transaction count per category — basis for the prior P(category)
  categoryTransactionCounts: Map<string, number>;
  // distinct word count across the whole corpus — smoothing denominator
  vocabularySize: number;
};

// One entry in category_policy.json: a plain category name (an implicit
// weight-1 row correction) or an explicit weight (a category declaration).
type CategoryPolicyEntry = string | { category: string; weight: number };
type CategoryPolicy = Record<string, CategoryPolicyEntry>;

type RankedCategory = { category: string; score: number };
```

No `exactMatches` field — see §5 for why the history-derived version of
that idea was dropped in favor of `decide()` reading `category_policy.json`
directly.

## 5. Human-in-the-loop, decoupled from the pipeline run

The category isn't statement-provided data for new-format months — it's
derived metadata either way, whether it comes from the classifier or from a
human. That removes the earlier concern about keeping `transactions/*.json`
strictly statement-faithful: policy entries don't need to be reconciled
against the original PDF, since the PDF never had a category to begin with.

Proposed default: a single hand-maintained file, `category_policy.json`,
serving two related but distinct purposes under one schema, keyed by
whatever string you want tokenized:

- **Row-level correction.** A plain string value —
  `{ "Merchant String": "Category" }` — treated as one synthetic
  transaction (weight 1) under that category, and the matching history
  row(s) are excluded from training so the correction fully replaces the
  old label rather than competing with it. This is the
  `Undecided`/misclassified-row fix from the original design: add an
  entry, it's fixed, picked up automatically next time the model is
  rebuilt.
- **Category-level declaration.** An object value with an explicit
  weight — `{ "Depot": { "category": "Ferreteria", "weight": 30 } }` —
  treated as `weight` synthetic transactions instead of one. This is for
  redefining how an entire recurring word should be categorized going
  forward, not fixing a single row: e.g. wanting `Home Depot Playa Del C`
  (currently `Electrónicos`, per history) to instead anchor its own
  `Ferreteria` category, or wanting `Oxxo` broken out of `Supermercado`
  entirely. The weight only needs to be *obviously* larger than whatever
  count it's competing with — `OXXO` currently has 11 real `Supermercado`
  examples, so a weight of 25–30 wins outright — there's no need to
  compute it precisely, since overshooting costs nothing at this data
  volume. Seeding a category this way also establishes it outright: a
  category that's never appeared in history (like `Ferreteria`) starts
  existing in the model — word counts *and* the `categoryTransactionCounts`
  prior — the moment a policy entry names it. No separate "register a
  category" step exists or is needed.

  One caveat worth remembering when choosing the key for a declaration:
  `tokenize()` doesn't know the words in a multi-word key are related —
  Naive Bayes treats every word as independent by design (§3.2). Seeding
  `"Home Depot"` at weight 30 pushes `HOME` *and* `DEPOT` independently
  toward `Ferreteria`, each becoming a strong standalone signal on its
  own; there's no way to weight the *pair* without them. In this case
  that's harmless (neither word means anything else in this corpus), but
  the general mitigation, if a constituent word is generic enough to risk
  misleading some unrelated future merchant, is to key the entry on the
  most distinctive single word (`"Depot"`) rather than the full merchant
  string — no code change needed, just a more deliberate choice of key.

`buildModel()` folds every policy entry into the same counts as history
(§4) — by the time `classify()` reads the model, a policy-sourced count
is indistinguishable from a bank-sourced one. But `decide()` also
consults `category_policy.json` directly, as a plain exact-key lookup,
*before* ever calling `classify()` — that's what makes a row correction
"stick" deterministically the moment it's added, rather than just
nudging Bayes's odds. (An earlier version of this design built that
exact-match guarantee from history too, as a `CategoryModel` field
called `exactMatches` — dropped once it became clear Laplace smoothing
already makes Bayes overwhelmingly confident on well-attested history,
so the only place determinism actually mattered was here, on
hand-authored policy entries.)

This file is small, diffable, and reviewable in a normal PR/commit — a
natural fit for "a couple dozen transactions isn't hard to curate by
hand."

Left open, to decide once this is actually built and lived with for a month
or two:
- Exact file location/schema for `category_policy.json` (root vs. a
  `data/` folder; keyed by raw or normalized merchant string).
- The confidence threshold value itself — will need tuning against real
  `Undecided` output once new-format months start flowing through.
- Whether `jsonToCsv.ts` should surface `Undecided` distinctly in the CSV
  (e.g. as literally `"Undecided"` in the `category-name` column) so it's
  easy to grep for and Firefly's own rules could potentially catch it.

## 6. Implementation note (for later)

Naive Bayes multiplies several probabilities, each less than 1 — with enough
words this can underflow to 0 in floating point. The standard fix is to work
in **log-probabilities** and add instead of multiply (`log(a × b) = log(a) +
log(b)`), which is worth doing from the start rather than retrofitting later.

## 7. Further reading

- **Bayes' theorem** — Wikipedia: `en.wikipedia.org/wiki/Bayes'_theorem`.
  For an intuitive visual explanation, 3Blue1Brown's YouTube video on Bayes'
  theorem is a good starting point.
- **Naive Bayes classifier** — Wikipedia:
  `en.wikipedia.org/wiki/Naive_Bayes_classifier`. For a rigorous but
  readable treatment with worked text-classification examples, see the
  "Naive Bayes and Sentiment Classification" chapter of Jurafsky & Martin's
  *Speech and Language Processing* (freely available online — search for the
  book title, it's a standard NLP reference).
- **Laplace / additive smoothing** — Wikipedia:
  `en.wikipedia.org/wiki/Additive_smoothing`.
- **TF-IDF** (deferred, but useful background) — Wikipedia:
  `en.wikipedia.org/wiki/Tf–idf`.
- **Levenshtein / edit distance** (deferred, but relevant if fuzzy matching
  is revisited later) — Wikipedia:
  `en.wikipedia.org/wiki/Levenshtein_distance`.

---

*Copied from `pdf_pipeline/CATEGORY_ENGINE.md`. Related: [[personal-finance-tracking]] (this is the design for the NU credit card categorization piece of that plan).*
