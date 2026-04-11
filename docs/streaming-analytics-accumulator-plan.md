# Streaming Analytics Accumulator Plan (No `rows[]` Materialization)

## Goal

Eliminate full in-memory referral row arrays during ingest and recompute by switching to a true streaming accumulator model:

- Parse -> normalize -> accumulate -> persist.
- Memory scales with **chunk size + accumulator maps**, not total row count.
- No full `rows[]` passed between worker/main thread.

---

## Why this is the next step

Current worker flow still materializes full row arrays in analytics code paths before computing `ReferralAnalytics`. On very large exports, this can spike memory and stall execution.

This plan replaces `computeReferralAnalytics(rows, ...)` with a **stateful accumulator** that can be updated per row or per batch.

---

## Target architecture

1. **Streaming parser (worker)**
   - Reads file incrementally.
   - Emits normalized row objects one at a time (or small batch).

2. **Accumulator engine (worker)**
   - Maintains mutable aggregate state:
     - counters
     - keyed maps
     - bounded top-N structures
     - compact sets for distinct counts
   - Updates state for each row.

3. **Row persistence (worker)**
   - Writes row batches to OPFS (`RowStore`) with IDB fallback.
   - Does not keep historical rows in memory.

4. **Finalize**
   - Converts aggregate state into `ReferralAnalytics` payload.
   - Sends small analytics payload to main thread.

5. **Filter recompute**
   - Stream rows from `RowStore`.
   - Apply filter predicates inline.
   - Update a fresh accumulator.
   - Return only analytics payload.

---

## Implementation phases

## Phase A — Introduce accumulator module

Create `src/lib/referralAnalyticsAccumulator.ts` with:

- `createAccumulator(context)`:
  - receives lookups (`sites`, `listings`, `users`) and calendar helpers.
- `accumulateRow(acc, row, scope)`:
  - updates all relevant aggregate structures for one row.
- `mergeAccumulator(acc, partial)` (optional if chunk-parallel is added later).
- `finalizeAccumulator(acc): ReferralAnalytics`.

Design rule: no method accepts `Record<string,string>[]`.

### Core state to track

- Totals:
  - `totalRows`, `distinctReferralRefs`, `uniqueSendingSites`, `uniqueTargetSites`, `uniqueSenders`, `uniqueProfIds`, `uniqueTargetRefs`.
- Time buckets:
  - monthly counts map (`YYYY-MM -> count`)
  - weekly counts map (with test/non-test splits and unique sender/receiver sets).
- Grouped breakdowns:
  - by target site, source site, sender
  - region/service/clinician type
  - EMR sent/received
  - referral source/FHIR counts.

### Memory discipline

- Use `Map` and compact primitive keys.
- Avoid storing full row payloads.
- Use approximate distinct counting (optional) only if memory pressure persists.

---

## Phase B — Use accumulator during ingest

Update `file-parser.worker.ts`:

- For CSV and XLSX flows:
  - initialize accumulator.
  - on each parsed row:
    - normalize,
    - update accumulator,
    - append to row store batch.
  - flush batches every N rows (e.g., 5k–10k).
- Remove all `rows.push(...)` usage in ingest path.
- On complete:
  - `finalizeAccumulator(...)`
  - post `{ type: 'complete', analytics, metadata, headerDiag }`.

Acceptance:

- Ingest memory no longer grows linearly with file rows.
- Main thread receives analytics/metadata only.

---

## Phase C — Use accumulator during filter recompute

Update `filter-from-store` worker request:

- Stream `RowStore.streamRead(10000)`.
- Apply filter predicate per row (`includeTest`, region refs).
- Accumulate filtered rows directly (no filtered array).
- Return only finalized analytics.

Acceptance:

- Filter toggles no longer create large temporary arrays.
- Recompute stays responsive on million-row datasets.

---

## Phase D — Tighten UI contract

Update hook/UI contract to analytics-only:

- `useFileParser` stores:
  - `analytics`, `metadata`, `progress`, `error`, `isLoading`.
- Remove row-derived UI dependencies from `App.tsx`.
- Use metadata counts and analytics totals for badges/KPIs.

Acceptance:

- Referral feature remains functional with no referral row arrays in React state.

---

## Phase E — Instrumentation and guardrails

Add worker telemetry events:

- `parse_start`, `parse_chunk`, `parse_complete`
- `store_flush_ms`
- `accumulate_ms`
- `finalize_ms`
- `recompute_start`, `recompute_complete`

Track:

- row throughput (rows/sec)
- peak batch size
- elapsed time per stage
- serialized payload size to main thread.

Add safety limits:

- max retained top-N lists in memory
- fail-fast message if accumulator map sizes exceed configured thresholds.

---

## Suggested rollout strategy

1. Implement accumulator module behind feature flag `STREAMING_ACCUMULATOR_V1`.
2. Enable for CSV ingest first.
3. Enable for XLSX ingest next.
4. Enable for filter recompute.
5. Remove legacy `rows[]` analytics path after parity verification.

---

## Verification checklist

- [ ] Ingest 1M+ CSV with no `rows[]` allocations in worker code path.
- [ ] No large `postMessage` payloads containing row arrays.
- [ ] Filter recompute works repeatedly without memory climb.
- [ ] KPI/table values match legacy analytics outputs on golden datasets.
- [ ] Export from store still works for full dataset.

---

## Definition of done

Done = referral ingest + filter recompute + analytics rendering all run without any full row array materialization in worker or main thread, while preserving metric parity and current UX.

