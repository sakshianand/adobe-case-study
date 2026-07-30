# AI Integration — Where It's Used, Why, and How Errors Are Handled

**Deliverable:** AI integration write-up — where AI is used, why, and how errors are handled
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) (full system diagrams, §7 covers this same ground visually), [HIGH_LEVEL_DESIGN.md](HIGH_LEVEL_DESIGN.md) (design rationale)

---

## 1. The governing principle

Every AI call in this system does exactly one of two things: **interpret something fuzzy** (a misspelled campaign name, a free-form question) or **phrase an already-computed fact into English**. AI is never the thing that computes a number, and it is never the thing that applies a change to data.

> Deterministic code computes every fact. AI interprets fuzzy input and phrases facts into English. A human authorises every change to data.

This single rule is what makes the answer to "how are errors handled" mostly boring, in a good way: because AI never sits on the critical path for *correctness* — only for *suggestion quality* or *narration quality* — an AI failure degrades a specific, contained thing (a missing sentence, a missing suggestion) rather than corrupting the pipeline or losing data. The sections below walk through where AI is used, why that specific integration exists, and exactly what happens when it fails.

---

## 2. Where AI is used — six integration points

| # | Integration point | Model | Where in the code |
|---|---|---|---|
| ① | Campaign name matching | `Xenova/all-MiniLM-L6-v2` (local embeddings) | `services/ai/matching/campaignMatcher.js` |
| ② | Question embedding (for semantic search) | `Xenova/all-MiniLM-L6-v2` (local embeddings) | `services/ai/rag/semanticHandler.js` |
| ③ | Run summary embedding (builds the search index) | `Xenova/all-MiniLM-L6-v2` (local embeddings) | `services/ai/rag/indexer.js` |
| ④ | AI quality summary | Groq `llama-3.3-70b-versatile` | `services/ai/summary/qualitySummary.js` |
| ⑤ | Structured RAG narration ("how many files below 80%?") | Groq `llama-3.3-70b-versatile` | `services/ai/rag/structuredHandler.js` |
| ⑥ | Semantic RAG answer ("why did the Meta upload fail?") | Groq `llama-3.3-70b-versatile` | `services/ai/rag/semanticHandler.js` |

Not listed, and deliberately not AI: **query routing** (`services/ai/rag/queryRouter.js`) decides whether a question needs the structured or semantic path using a regex classifier, not a model call. There are a small number of known question shapes (`how many`, `below X%`, `show me all…`), a wrong route is cheap to fix with one more pattern, and a model here would add latency, cost, and non-determinism for no accuracy gain. It's included here because it's the point people most often assume is AI and isn't — worth naming explicitly.

---

## 3. Why each integration exists

### ① Campaign name matching — *why AI, specifically*

Marketing teams export campaign names inconsistently across platforms — `"Summer Sale 2024"` vs `"summer_sale_24"` vs `"Summer Sale '24 - Google"`. There is no lookup table that maps every possible spelling variant to a canonical name; the space of typos and formatting differences is open-ended. This is the textbook shape of a problem embeddings are good at and exact-match rules are not.

**What AI actually decides:** nothing. `campaignMatcher.js` embeds the uploaded name, cosine-compares it against ~15 cached master campaign vectors, and returns a similarity score. Deterministic code then applies a fixed 60% threshold to turn that score into `suggest` or `flag_for_review`. Either way, the row is never modified — the match is a pending suggestion, and only a human's approve/reject decision (`POST /approve`) actually changes what's written to the ad platform or Databricks silver table.

### ②③ RAG retrieval (question + run-summary embedding) — *why AI*

The dashboard's "ask a question about ingestion history" feature needs to answer things like *"why did the Meta upload fail last week?"* — a question that has no fixed schema to filter against. Embedding both the question and every completed run's summary, then retrieving the nearest matches, is the standard way to search unstructured history semantically instead of requiring the user to know exact filter syntax.

**What AI actually decides:** which past runs are *most related* to the question. It does not decide what happened in those runs — the retrieved text is a summary built entirely from `validationSummary` fields (§4 below), and the LLM step downstream only narrates what was retrieved.

### ④ AI quality summary — *why AI*

Every validation run produces ~10 separate numeric facts (corrections by field, duplicate count, date flags, quality score, etc.). Turning a JSON object into one readable sentence is a pure language task with no ambiguity to resolve — it's a good fit for an LLM specifically *because* there's nothing to decide, only something to phrase.

**What AI actually decides:** wording only. `buildSummaryFacts()` computes every number before the model is ever called; the prompt hands the model a finished JSON fact object and instructs it to never invent a number, omit zero-count categories, and never call a suggested match "auto-corrected" (since the matcher never applies one).

### ⑤ Structured RAG narration — *why AI*

Questions like *"how many files came in below 80% quality?"* have an exact, computable answer — but the user asked in English, not SQL. `structuredHandler.js` extracts filters from the question with regex (threshold, platform, date range), gets the exact answer from `jobStore.queryJobs()`, and only then calls the model — purely to turn a filtered list into a sentence with citations.

**What AI actually decides:** phrasing and which of the *already-fetched* facts to lead with. It cannot answer with a number it wasn't given, because the count was never handed to it as an open-ended question — it was handed the finished, filtered result set.

### ⑥ Semantic RAG answer — *why AI*

For genuinely open-ended questions ("why did X fail?") there's no filter to extract — the answer requires narrative reasoning over retrieved text. Classic retrieve-then-generate: Chroma retrieval finds the relevant run summaries (②③), and the LLM is instructed to answer *only* from what was retrieved.

---

## 4. Grounding discipline — how each integration is kept honest

This is the mechanism that makes "why does the AI not just make things up" a solved problem rather than a hope:

| Integration | Grounding mechanism |
|---|---|
| ① Campaign matching | The confidence score is real, but the *decision* (`suggest` vs `flag_for_review`) is a fixed threshold in code, not a model output. Nothing is ever auto-applied — every suggestion is a pending human decision, enforced through to Databricks ingestion. |
| ②③ RAG retrieval | Retrieval is scoped to one Chroma collection (`ingestion_runs_v1`) built entirely from deterministically-generated summary text (`buildRunSummaryText()` in `indexer.js`) — there is no path for the retriever to surface anything that wasn't itself built from real job data. |
| ④ Quality summary | The system prompt hands the model an exact JSON fact object and instructs: *"Never invent a number, field name, or count not present in them,"* *"Only mention a category if its count is greater than zero,"* and *"Campaign name matches are suggestions for a human to approve, never call them auto-corrected."* |
| ⑤ Structured RAG | `queryJobs()` computes the exact filtered result **before** the model is called. The prompt states: *"Never invent a number, file name, or count not present in the facts... If the facts list is empty, say plainly that no matching runs were found — do not guess."* |
| ⑥ Semantic RAG | The prompt states: *"Use ONLY the run summaries retrieved below... If no run summaries were retrieved, say plainly that no matching runs were found — do not guess."* |

The pattern repeating across ④⑤⑥ is deliberate: every LLM prompt in this system explicitly names its own boundary ("use only what I've given you") and explicitly names the honest failure mode ("say not-found, don't guess"). This is not a general safety instruction — each prompt states the *specific* facts it must not go beyond, because those facts are different in each case.

---

## 5. How errors are handled — point by point

The single most important design decision here: **critical-path correctness never depends on an AI call succeeding.** Concretely, that means only one of the six integrations (①) is even capable of blocking an upload from completing, and even that failure mode is a hard model-load error, not "the AI gave a bad answer."

### ① Campaign name matching — failure is on the critical path, by necessity

```js
// routes/upload.js — runJob()
const matches = await matchAllCampaigns(validationSummary.processedCampaigns);
```

This call is `await`ed with no surrounding `try/catch` in `runJob`. If it throws (e.g. the Xenova model fails to load, or a normalization bug throws on unexpected input), the *outer* try/catch in `runJob` catches it and the whole job is marked `status: 'failed'` with the error message recorded.

**Why this one is allowed to fail the job, when nothing else is:** campaign matching runs against every uploaded campaign, and its output (`matches[]`) is part of what the Validation Results and Review pages need to render at all. Unlike the quality summary (an optional narrative addition) or RAG indexing (a search-index side effect), a missing `matches[]` would leave the Review page with nothing to review. In practice this failure mode is rare — a *bad* match (low confidence) is not an error, it's the expected `flag_for_review` output — but a **model load failure** or thrown exception inside the matching pass is a real "job failed" event, surfaced to the user via the job's `status` and `error` fields.

### ④ AI quality summary — explicitly isolated, wrapped in its own try/catch

```js
// routes/upload.js — runJob()
let qualitySummary = null;
try {
  qualitySummary = await generateQualitySummary({ validationSummary, matches });
} catch (err) {
  console.error('AI quality summary failed for job', jobId, err.message);
}
const finishedJob = updateJob(jobId, { status: 'complete', matches, qualitySummary });
```

If Groq is down, rate-limited, or the call throws for any reason, `qualitySummary` stays `null` and **the job still completes.** The Validation Results page has a fallback for a missing summary sentence (it just doesn't render one) — the user still sees every underlying number (`validationSummary`), just without the one-sentence narration. This is the clearest example in the codebase of the "fail-open on phrasing, fail-closed on facts" rule: an outage here costs a sentence, never a row of data.

### ②③ RAG indexing — fire-and-forget, isolated from the response entirely

```js
// routes/upload.js — runJob()
indexJob(finishedJob).catch((err) => console.error('RAG indexing failed for job', jobId, err.message));
```

This call isn't even `await`ed — it fires after the job is already marked `complete` and the client has already gotten its answer. A Chroma outage, an embedding failure, or any other error is caught and logged, and has **zero effect** on the upload, the job's status, or anything the user sees at upload time. The only consequence is that this specific run becomes unsearchable by the semantic assistant until the failure is investigated and the run is re-indexed — a search-index gap, not a data-loss event.

Additionally, `indexer.js`'s `getCollection()` lazily requires `chromadb` on first use rather than at module load — so if Chroma isn't reachable, the server itself still boots and every non-RAG feature works; only the first indexing or query attempt surfaces the error, and it surfaces per-call, not as a startup crash.

### ⑤⑥ RAG query (structured and semantic) — synchronous, but scoped to one endpoint

```js
// routes/assistant.js
try {
  const history = getHistory(sessionId);
  const route = classifyQuery(message);
  const result = route === 'structured'
    ? await handleStructuredQuery(message, history)
    : await handleSemanticQuery(message, history);
  ...
  res.status(200).json(result);
} catch (err) {
  console.error('Assistant query failed:', err);
  res.status(500).json({ error: 'Could not process that question right now.' });
}
```

A Groq failure, a Chroma failure, or an embedding failure during a chat query is caught at the route level and turned into a `500` with a plain user-facing message. This is the one place an AI failure is directly user-visible in real time — appropriately, since answering the question *is* the entire point of that request — but it's fully contained to that one chat turn. It doesn't affect any job's status, doesn't corrupt conversation history (the failed turn is never appended via `appendTurn`), and doesn't cascade to any other feature. The user can simply ask again.

### Summary table

| Integration | Awaited? | Wrapped in try/catch? | Failure mode | Blast radius |
|---|---|---|---|---|
| ① Campaign matching | Yes | No (relies on `runJob`'s outer catch) | Job → `status: failed`, error message recorded | This job only — no other job or feature affected |
| ② Question embedding | Yes | Yes, at the route level | `500` returned to the chat UI | This one query turn only |
| ③ Run summary indexing | **No** (fire-and-forget) | Yes, `.catch()` on the promise | Logged; run is un-searchable but otherwise intact | Zero — invisible to the uploading user |
| ④ Quality summary | Yes | Yes, dedicated try/catch | `qualitySummary: null`; job still completes normally | A missing sentence on one screen |
| ⑤ Structured RAG narration | Yes | Yes, at the route level | `500` returned to the chat UI | This one query turn only |
| ⑥ Semantic RAG answer | Yes | Yes, at the route level | `500` returned to the chat UI | This one query turn only |

---

## 6. What this buys, stated plainly

Because every AI call is either (a) producing a *suggestion* a human must approve, or (b) producing *prose* describing facts computed elsewhere, the failure taxonomy collapses to two boring cases: **a missing suggestion** (worst case: a campaign name needs manual review instead of a pre-filled suggestion) or **a missing sentence** (worst case: a screen shows numbers without a narrative summary, or a chat query needs to be retried). There is no failure mode in this system where an AI error corrupts a validated row, applies an unapproved change, or takes down the upload pipeline. That property isn't incidental — it's the direct consequence of the compute-then-phrase / suggest-never-apply boundary described in §1, applied consistently across all six integration points.
