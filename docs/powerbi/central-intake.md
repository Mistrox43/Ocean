# Central Intake — PowerBI Methodology Reference

> **Audience:** PowerBI developers rebuilding the Central Intake dashboard from the same raw input file.
> **Goal:** End-to-end traceability — for every card and table, identify the raw columns it uses, the normalization applied, and the exact formula used to produce the displayed value.

---

## Table of contents

1. [Overview & scope](#1-overview--scope)
2. [Raw data source](#2-raw-data-source)
3. [Normalization rules (Power Query M)](#3-normalization-rules-power-query-m)
4. [Derived columns](#4-derived-columns)
5. [Filters](#5-filters)
   - [5.1 Global filter — Initial Referral Target](#51-global-filter--initial-referral-target)
   - [5.2 Tab-level cascade (FY ▸ Q ▸ M ▸ W)](#52-tab-level-cascade-fy--q--m--w)
6. [KPI cards](#6-kpi-cards)
7. [Backlog section](#7-backlog-section)
8. [Donut & gauge charts](#8-donut--gauge-charts)
9. [Tabbed tables](#9-tabbed-tables)
10. [Field-presence visibility rules](#10-field-presence-visibility-rules)
11. [Helper math (DAX equivalents)](#11-helper-math-dax-equivalents)
12. [End-to-end worked example](#12-end-to-end-worked-example)
13. [Appendix: code cross-reference](#13-appendix-code-cross-reference)

---

## 1. Overview & scope

The **Central Intake** tab tracks the volume, processing speed, and waiting times of referrals that flow through a Central Intake queue. It surfaces, at a glance:

- How many referrals were processed and how many distinct patients they represent
- How long Central Intake takes to forward each referral (the "CI processing cycle")
- How long patients then wait for their first and second appointments (Wait 1 / Wait 2)
- A backlog snapshot — referrals currently sitting in Central Intake that haven't been forwarded yet
- Volume mix — by month, by referrer, by recipient, by sent method, by patient preference

**In scope:** the entire Central Intake tab — 8 KPI cards, 3 backlog visuals, 2 donuts, 2 gauges, and 6 tabbed tables.

**Out of scope:** all other tabs (Listings, Sites, Users, Referrals, Data Quality). The Central Intake tab depends on a **single** raw input — the Ocean Referral Analytics export — so the other input files (Listings, Sites, Users) are irrelevant here.

**Source-of-truth code** (this document tracks these files):

| Concern | File |
| --- | --- |
| UI layout & visibility | `src/components/intake/CentralIntakeTab.tsx` |
| Date/percentile helpers, filter cascade, final aggregation | `src/lib/intakeAnalytics.ts` |
| Per-row ingestion into month buckets | `src/lib/referralAnalyticsAccumulator.ts` (`accumulateIntake`, `finalizeIntake`) |
| Raw → canonical column mapping | `src/constants.ts` (REFERRAL_MAP) |
| Type definitions | `src/types.ts` (IntakeAnalytics, IntakeView, IntakeFieldPresence) |

---

## 2. Raw data source

**File type:** Ocean Referral Analytics export, either `.xlsx` or `.csv`.

**Required columns** (rows missing any of these are dropped during ingest): `referralCreationDate`, `referralRef`, `referralTargetRef`.

**Columns consumed by the Central Intake tab:**

| Raw column (any of these header variants) | Canonical name | Data type | Example | Used by |
| --- | --- | --- | --- | --- |
| `referralCreationDate`, `referralcreationdate` | `referralCreationDate` | ISO date OR Excel serial number | `2025-06-15`, `45823` | Month/Quarter/FY/Week bucketing; fallback for Wait1/Wait2 calc |
| `referralInitialCreationDate`, `referral initial creation date` | `referralInitialCreationDate` | ISO **timestamp** (with time-of-day) | `2026-04-21T14:52:00-04:00` | CI cycle start; backlog age |
| `initialForwardDate`, `initial forward date` | `initialForwardDate` | ISO **timestamp** | `2026-04-21T15:10:00-04:00` | CI cycle end |
| `referralDeleted`, `referral deleted` | `referralDeleted` | Boolean | `TRUE` / `FALSE` | Row filter — `TRUE` rows are dropped |
| `patientId`, `patient id`, `Patient ID` | `patientId` | String | `PAT123456` | Unique-patient count |
| `patientPreference`, `ax_patientPreference`, `patient preference` | `patientPreference` | String (fuzzy-matched) | `Specific Surgeon` | Patient Preference donut |
| `receivedReferralComplete`, `ax_receivedReferralComplete` | `receivedReferralComplete` | Boolean | `TRUE` / `FALSE` | Received Complete donut |
| `wait1Days`, `wait 1 days` | `wait1Days` | Numeric (days) | `5`, `12.5` | Wait 1 metrics (preferred source) |
| `scheduledAppointment`, `scheduled appointment` | `scheduledAppointment` | ISO date OR Excel serial | `2025-07-01` | Wait 1 fallback if `wait1Days` blank |
| `wait2Days`, `wait 2 days` | `wait2Days` | Numeric (days) | `15`, `21` | Wait 2 metrics (preferred source) |
| `scheduledAppointment2`, `scheduled appointment 2` | `scheduledAppointment2` | ISO date OR Excel serial | `2025-08-01` | Wait 2 fallback if `wait2Days` blank |
| `centralIntakeRef`, `central intake ref`, `Central Intake Ref` | `centralIntakeRef` | String | `CI98765` | Flag: row participated in CI processing |
| `referralState`, `referralstate` | `referralState` | String enum | `SENT`, `ACCEPTED`, `COMPLETED`, `CANCELLED` | Backlog-by-state breakdown |
| `recipientName`, `recipientname` | `recipientName` | String | `Dr. Jane Doe Clinic` | Recipient grouping, "Current Location" |
| `referrerName`, `referrername` | `referrerName` | String | `JOHN SMITH` | Referrer grouping |
| `referralSource`, `referralsource` | `referralSource` | String | `Email`, `Fax`, `eReferral` | Sent-type ("method") grouping |
| `referralRef`, `referralref` | `referralRef` | String | `REF12345` | (required; identifies the row) |

**Mapping reference:** `src/constants.ts:80-143` (REFERRAL_MAP defines every accepted header variant). `src/constants.ts:169-185` (USED_FIELDS.referral) lists every canonical name consumed.

**Headers are matched case- and space-insensitively.** PowerBI Power Query should perform an equivalent rename step before any downstream logic.

---

## 3. Normalization rules (Power Query M)

These rules are applied during ingest in `src/workers/file-parser.worker.ts` and the helpers in `src/utils.ts` / `src/lib/intakeAnalytics.ts`. Replicate them in Power Query before building any measures.

### 3.1 Header rename (case-insensitive)

The application matches headers case- and space-insensitively against REFERRAL_MAP. In Power Query, normalize then rename:

```m
// Lowercase + strip spaces, then rename to canonical names
RenameHeaders =
    Table.RenameColumns(
        Source,
        {
            {"referralcreationdate", "referralCreationDate"},
            {"referralinitialcreationdate", "referralInitialCreationDate"},
            {"initialforwarddate", "initialForwardDate"},
            {"referraldeleted", "referralDeleted"},
            {"patientid", "patientId"},
            {"ax_patientpreference", "patientPreference"},
            {"patientpreference", "patientPreference"},
            {"ax_receivedreferralcomplete", "receivedReferralComplete"},
            {"receivedreferralcomplete", "receivedReferralComplete"},
            {"wait1days", "wait1Days"},
            {"wait2days", "wait2Days"},
            {"scheduledappointment", "scheduledAppointment"},
            {"scheduledappointment2", "scheduledAppointment2"},
            {"centralintakeref", "centralIntakeRef"},
            {"referralstate", "referralState"},
            {"recipientname", "recipientName"},
            {"referrername", "referrerName"},
            {"referralsource", "referralSource"}
        },
        MissingField.Ignore
    )
```

### 3.2 Excel serial date → ISO date

Excel-origin dates may arrive as numbers (e.g. `45823`). The dashboard converts using:

```
date = new Date( (serial - 25569) * 86400 * 1000 )  // 25569 = days from 1899-12-30 to 1970-01-01
```

Power Query equivalent:

```m
// Coerce Excel serial OR ISO string to date
NormDate = (v as any) as nullable date =>
    if v = null or v = "" then null
    else if Value.Is(v, type number) then
        Date.From(#date(1899,12,30)) + Duration.From(v)
    else
        try Date.FromText(Text.Start(Text.From(v), 10)) otherwise null
```

Apply to `referralCreationDate`, `scheduledAppointment`, `scheduledAppointment2`.

### 3.3 Timestamp preserved (CI cycle only)

`referralInitialCreationDate` and `initialForwardDate` are **timestamps** (with time-of-day). Truncating these to dates would collapse same-day forwards to 0, which is wrong. Source: `intakeAnalytics.ts:48-63` (`parseTimestamp`).

```m
NormTimestamp = (v as any) as nullable datetimezone =>
    if v = null or v = "" then null
    else if Value.Is(v, type number) then
        DateTimeZone.From(#datetime(1899,12,30,0,0,0)) + Duration.From(v)
    else
        try DateTimeZone.FromText(Text.From(v)) otherwise null
```

Apply **only** to `referralInitialCreationDate` and `initialForwardDate`.

### 3.4 Boolean parse

Accept `true|1|yes|y` → TRUE and `false|0|no|n` → FALSE (case-insensitive). Anything else → null. Source: `intakeAnalytics.ts:73-79`.

```m
NormBool = (v as any) as nullable logical =>
    let s = Text.Lower(Text.From(v ?? "")) in
        if List.Contains({"true","1","yes","y"}, s) then true
        else if List.Contains({"false","0","no","n"}, s) then false
        else null
```

Apply to `referralDeleted` and `receivedReferralComplete`.

### 3.5 Numeric parse

Trim, strip commas, parse float. Source: `intakeAnalytics.ts:65-71`.

```m
NormNum = (v as any) as nullable number =>
    let s = Text.Trim(Text.Replace(Text.From(v ?? ""), ",", "")) in
        if s = "" then null else try Number.From(s) otherwise null
```

Apply to `wait1Days`, `wait2Days`.

### 3.6 Row exclusion

After the rules above, **drop any row** where:

- `referralDeleted = TRUE`, **OR**
- `referralCreationDate` is null

Source: `referralAnalyticsAccumulator.ts:202-203`.

```m
FilterRows = Table.SelectRows(Normalized, each
    [referralDeleted] <> true and [referralCreationDate] <> null
)
```

### 3.7 String trim & case rules

- `recipientName` — `Text.Trim`. Empty becomes `"(Unknown)"` for grouping. (`referralAnalyticsAccumulator.ts:306-307`)
- `referrerName` — `Text.Upper(Text.Trim(...))`. Empty becomes `"(UNKNOWN)"`. (`referralAnalyticsAccumulator.ts:317`)
- `referralSource` — `Text.Trim`. Empty becomes `"(Unknown)"`. (`referralAnalyticsAccumulator.ts:320`)
- `referralState` — leave as-is. Empty becomes `"UNKNOWN"` only inside the backlog-by-state aggregation. (`intakeAnalytics.ts:268`)

---

## 4. Derived columns

Computed once per row after normalization, before measures are evaluated.

### 4.1 `month` (YYYY-MM)

```dax
month = FORMAT( Referrals[referralCreationDate], "YYYY-MM" )
```

### 4.2 `fiscalYear` — Ontario fiscal year (Apr–Mar)

`FY2025-26` covers Apr 1 2025 → Mar 31 2026. Source: `intakeAnalytics.ts:10-15`.

```dax
fiscalYear =
VAR Y = YEAR( Referrals[referralCreationDate] )
VAR M = MONTH( Referrals[referralCreationDate] )
VAR StartY = IF( M >= 4, Y, Y - 1 )
RETURN "FY" & StartY & "-" & RIGHT( StartY + 1, 2 )
```

### 4.3 `quarter` — `{FY} Q{n}`

Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar. Source: `intakeAnalytics.ts:17-25`.

```dax
quarter =
VAR M = MONTH( Referrals[referralCreationDate] )
VAR Q = SWITCH( TRUE(),
    M >= 4 && M <= 6,  "Q1",
    M >= 7 && M <= 9,  "Q2",
    M >= 10 && M <= 12,"Q3",
    "Q4"
)
RETURN Referrals[fiscalYear] & " " & Q
```

### 4.4 `isoWeek` — Monday-start ISO-8601 week

Returns the **Monday of the week containing the date** as a date. Source: `intakeAnalytics.ts:30-38`.

```dax
isoWeek =
VAR D = Referrals[referralCreationDate]
VAR Dow = WEEKDAY( D, 2 )      -- 1 = Mon, 7 = Sun
RETURN D - ( Dow - 1 )
```

### 4.5 `wait1` (days)

Prefer `wait1Days` if numeric; otherwise compute `scheduledAppointment - referralCreationDate`. Keep only if ≥ 0. Source: `referralAnalyticsAccumulator.ts:258-263`.

```dax
wait1 =
VAR W = Referrals[wait1Days]
VAR Fallback = DATEDIFF( Referrals[referralCreationDate], Referrals[scheduledAppointment], DAY )
VAR Result = COALESCE( W, Fallback )
RETURN IF( NOT ISBLANK( Result ) && Result >= 0, Result )
```

### 4.6 `wait2` (days)

Same logic with `wait2Days` / `scheduledAppointment2`. Source: `referralAnalyticsAccumulator.ts:265-270`.

### 4.7 `cycleDays` (CI processing — intra-day precision)

Only computed when **all three** are true:

- `centralIntakeRef` is non-empty
- `referralInitialCreationDate` is present
- `initialForwardDate` is present

The result must preserve fractional days, e.g. a 4-hour forward = 0.167 days, not 0. Source: `referralAnalyticsAccumulator.ts:272-284`.

```dax
cycleDays =
VAR HasCI = NOT ISBLANK( Referrals[centralIntakeRef] )
VAR D = DATEDIFF(
    Referrals[referralInitialCreationDate],
    Referrals[initialForwardDate],
    SECOND
) / 86400.0
RETURN IF(
    HasCI
    && NOT ISBLANK( Referrals[referralInitialCreationDate] )
    && NOT ISBLANK( Referrals[initialForwardDate] )
    && D >= 0,
    D
)
```

### 4.8 `isOpenCI` — backlog flag

```dax
isOpenCI =
    NOT ISBLANK( Referrals[centralIntakeRef] )
 && NOT ISBLANK( Referrals[referralInitialCreationDate] )
 &&     ISBLANK( Referrals[initialForwardDate] )
```

Source: `referralAnalyticsAccumulator.ts:285-292`.

### 4.9 `normalizedPatientPref` — canonical preference label

Source: `intakeAnalytics.ts:99-113`.

```dax
normalizedPatientPref =
VAR S = LOWER( TRIM( Referrals[patientPreference] ) )
RETURN SWITCH( TRUE(),
    S = "", BLANK(),
    LEFT( S, 6 ) = "specif",  "Specific Surgeon",
    SEARCH( "first", S, 1, 0 ) > 0, "First Available Surgeon",
    SEARCH( "clos",  S, 1, 0 ) > 0, "Surgeon Closest to Patient Home",
    Referrals[patientPreference]
)
```

---

## 5. Filters

Two filtering layers apply to every Central Intake visual. **Both must be implemented** for the PowerBI dashboard to match the application.

### 5.1 Global filter — Initial Referral Target

A multi-select control elsewhere on the page (outside the Central Intake tab) lets the user restrict the entire dataset to specific **initial referral targets**. The control is labelled with placeholder text `All Initial Targets` and is bound to the raw column `initialReferralTargetRef`.

| | |
| --- | --- |
| **Raw column filtered** | `initialReferralTargetRef` |
| **Control** | Multi-select combobox (`App.tsx:228`) |
| **Options** | Distinct values of `initialReferralTargetRef` present in the loaded data; each labelled with the looked-up listing title from the Listings export when available, otherwise the raw ref. Options sorted alphabetically by ref. (`referralAnalytics.ts:132-134`, `referralAnalyticsAccumulator.ts:138-139, 445`) |
| **Default** | No selection ⇒ all rows pass |
| **Application point** | Applied during row streaming, **before** any aggregation, in the worker: `if (initialTargetSet && !initialTargetSet.has(row.initialReferralTargetRef)) continue;` (`file-parser.worker.ts:344`) |
| **Scope** | **Applies to every tab in the application, including Central Intake.** Every KPI, chart, gauge, and table on the Central Intake tab must reflect this filter. |

**Why this matters for PowerBI:** because the filter runs at the raw-row level — earlier than every measure documented in this file — the PowerBI implementation must be at least as broad. The recommended approach is a **report-level slicer** on `initialReferralTargetRef`, so that selecting one or more initial targets restricts the Central Intake page along with every other report page.

```dax
// Raw column on the Referrals fact table
InitialReferralTargetRef = Referrals[initialReferralTargetRef]
```

```m
// Optional: surface a friendly label combining ref + listing title
InitialTargetLabel = (ref as text) as text =>
    let title = try ListingsLookup{[ref = ref]}[title] otherwise ref in
        if title = ref then ref else ref & " — " & title
```

Add a slicer on `initialReferralTargetRef` (or the friendly label) and set it to **Sync slicers** across all report pages so selecting a value on any page propagates to the Central Intake page automatically.

**Interaction with the tab-level cascade (§5.2):** the two filters compose with logical AND. A row contributes to a Central Intake visual only if it passes the global Initial Referral Target filter **and** falls into the selected FY/Q/M/W window.

> **Other global filters (informational, out of primary scope):** the application also has a Test Mode toggle (excludes rows where `sentToTestListing=TRUE`), a Region filter (filters on `referralTargetRef`), and an RA Name filter (filters on `raName`). They follow the same "applied at the raw-row level, affects every tab" pattern. If the PowerBI rebuild needs these too, mirror them as report-level slicers using the corresponding raw columns. Source: `file-parser.worker.ts:294-349`.

### 5.2 Tab-level cascade (FY ▸ Q ▸ M ▸ W)

The Central Intake tab itself has a single filter bar at the top: **Fiscal Year ▸ Quarter ▸ Month ▸ Week**.

Behavior:

- Selecting a higher level **clears** any selections below it.
- With nothing selected, the view shows **all-time** data (subject to §5.1).
- Week options are populated only when a Month is selected.

Cascade resolution: `intakeAnalytics.ts:130-145`. The selected level determines which month-buckets contribute to the aggregation:

| Selection state | Months included |
| --- | --- |
| Week set | The single month that contains the selected ISO week |
| Month set (no Week) | The selected month only |
| Quarter set (no Month) | All months in that quarter |
| FY set (no Quarter) | All months in that fiscal year |
| Nothing set | All months in the dataset |

**PowerBI implementation:** four slicers in cascade. The natural hierarchy is `fiscalYear → quarter → month → isoWeek`. Build a date dimension keyed on `month` to drive slicer selection, then propagate filters via a one-to-many relationship to `Referrals`. These slicers should be **page-level** to the Central Intake page (the global Initial Referral Target slicer in §5.1 should be report-level).

> **Note on backlog:** the backlog reference date is **always** the latest `referralCreationDate` in the **entire dataset** (after the global filter from §5.1 has been applied), regardless of the active cascade. The cascade controls which open referrals are *counted*, not which date is used as "as of." Source: `intakeAnalytics.ts:245`.

---

## 6. KPI cards

The cards render in `src/components/intake/CentralIntakeTab.tsx:179-228`. All values respect the active filter cascade.

### 6.1 # Referrals Processed

| | |
| --- | --- |
| **Display** | Whole-number count, accent-blue |
| **Source columns** | `referralDeleted` (filter), `referralCreationDate` (filter+bucket) |
| **Transformation** | After row exclusion (§3.6), bucket by `month` |
| **Calculation** | Sum of `total` across selected month buckets |
| **Filter** | Respects FY/Q/M/W cascade |

Source: `intakeAnalytics.ts:181, 280`.

```dax
ReferralsProcessed = COUNTROWS( Referrals )
```

### 6.2 # Unique Patients

| | |
| --- | --- |
| **Display** | Whole-number count, green. Shows "—" with sub "patientId not in export" if column absent |
| **Source columns** | `patientId` |
| **Transformation** | Distinct values |
| **Calculation** | DISTINCTCOUNT over filtered rows |
| **Filter** | Respects cascade |

Source: `intakeAnalytics.ts:182, 281`.

```dax
UniquePatients =
IF(
    ISBLANK( SELECTEDVALUE( Referrals[patientId], BLANK() ) ) && COUNTROWS( Referrals ) = 0,
    BLANK(),
    CALCULATE(
        DISTINCTCOUNT( Referrals[patientId] ),
        Referrals[patientId] <> BLANK()
    )
)
```

### 6.3 Avg Referral Processing Cycle (Days)

| | |
| --- | --- |
| **Display** | Number with 1 decimal, purple |
| **Source columns** | `centralIntakeRef`, `referralInitialCreationDate`, `initialForwardDate` |
| **Transformation** | `cycleDays` derived column (§4.7) |
| **Calculation** | Arithmetic mean of `cycleDays` across filtered rows |
| **Filter** | Respects cascade; only rows with valid `cycleDays` contribute |

Source: `intakeAnalytics.ts:282`. Formula in code: `cycleSum / cycleCount`.

```dax
AvgCycleDays = AVERAGE( Referrals[cycleDays] )
```

### 6.4 # Referrals included in Wait 1

| | |
| --- | --- |
| **Display** | Whole-number count, amber |
| **Source columns** | `wait1Days` (preferred), `scheduledAppointment`, `referralCreationDate` (fallback) |
| **Transformation** | `wait1` derived column (§4.5) |
| **Calculation** | Count of rows where `wait1 >= 0` |

Source: `intakeAnalytics.ts:292`.

```dax
Wait1Count = CALCULATE( COUNTROWS( Referrals ), NOT ISBLANK( Referrals[wait1] ) )
```

### 6.5 # Referrals included in Wait 2

Same as 6.4, with `wait2`. Color: blue.

```dax
Wait2Count = CALCULATE( COUNTROWS( Referrals ), NOT ISBLANK( Referrals[wait2] ) )
```

### 6.6 CI Processing Time — Median

Only displayed when `cycleDays` data is present. Source: `intakeAnalytics.ts:283`.

| | |
| --- | --- |
| **Display** | Number with 1 decimal. Sub: `≈ {value*24} hrs · {N} closed` |
| **Source** | `cycleDays` derived column |
| **Calculation** | `PERCENTILE.INC(cycleDays, 0.5)` (linear interpolation) |

```dax
CIProcessingMedian =
PERCENTILEX.INC(
    FILTER( Referrals, NOT ISBLANK( Referrals[cycleDays] ) ),
    Referrals[cycleDays],
    0.5
)

CIProcessingHrsLabel = "≈ " & FORMAT( [CIProcessingMedian] * 24, "0.0" ) & " hrs"
CIProcessingClosed   = COUNTROWS( FILTER( Referrals, NOT ISBLANK( Referrals[cycleDays] ) ) )
```

### 6.7 CI Processing Time — P75

```dax
CIProcessingP75 =
PERCENTILEX.INC(
    FILTER( Referrals, NOT ISBLANK( Referrals[cycleDays] ) ),
    Referrals[cycleDays],
    0.75
)
```

### 6.8 CI Processing Time — P90

```dax
CIProcessingP90 =
PERCENTILEX.INC(
    FILTER( Referrals, NOT ISBLANK( Referrals[cycleDays] ) ),
    Referrals[cycleDays],
    0.9
)
```

> **PERCENTILE semantics:** the code uses linear-interpolation percentile (`intakeAnalytics.ts:88-97`) which matches Excel's `PERCENTILE.INC` and DAX's `PERCENTILE.INC` / `PERCENTILEX.INC`. **Do not** substitute `PERCENTILE.EXC` — the values will not match.

---

## 7. Backlog section

Three side-by-side visuals, all visible only when the dataset contains "open CI" rows (`isOpenCI = TRUE`).

**Reference date** = `MAX( Referrals[referralCreationDate] )` over the **entire dataset**, not the filtered subset. Source: `intakeAnalytics.ts:245`.

**Backlog age (per row)** = days between `referralInitialCreationDate` and the reference date; only counted if ≥ 0. Source: `intakeAnalytics.ts:246-250`.

```dax
BacklogReferenceDate =
CALCULATE( MAX( Referrals[referralCreationDate] ), ALL( Referrals ) )

BacklogAge =        -- per-row calculated column on open rows
DATEDIFF(
    Referrals[referralInitialCreationDate],
    [BacklogReferenceDate],
    DAY
)
```

### 7.1 Days at CI (Backlog) — card

| | |
| --- | --- |
| **Display** | Large red count of open referrals + sub-line `open referrals · avg {n} days` |
| **Filter** | Respects cascade (only counts open rows from selected months) |

```dax
BacklogCount =
CALCULATE( COUNTROWS( Referrals ),
    Referrals[isOpenCI] = TRUE,
    Referrals[BacklogAge] >= 0
)

BacklogAvgDays =
CALCULATE( AVERAGE( Referrals[BacklogAge] ),
    Referrals[isOpenCI] = TRUE,
    Referrals[BacklogAge] >= 0
)
```

### 7.2 Backlog Age Distribution — histogram

Five fixed buckets (`intakeAnalytics.ts:252-258`):

| Bucket | Predicate |
| --- | --- |
| 0–3 | `age <= 3` |
| 4–7 | `3 < age <= 7` |
| 8–14 | `7 < age <= 14` |
| 15–30 | `14 < age <= 30` |
| 30+ | `age > 30` |

Build a static `BacklogBucket` table joined on row-level `BacklogAge`:

```dax
BacklogBucket =
SWITCH( TRUE(),
    Referrals[BacklogAge] <= 3,  "0–3",
    Referrals[BacklogAge] <= 7,  "4–7",
    Referrals[BacklogAge] <= 14, "8–14",
    Referrals[BacklogAge] <= 30, "15–30",
                                 "30+"
)
```

Plot as a bar chart with a fixed category order: `0–3, 4–7, 8–14, 15–30, 30+`.

### 7.3 Backlog by Referral State — table

| Column | Type | Format | Source |
| --- | --- | --- | --- |
| Referral State | text | as-is; blank → `"UNKNOWN"` | `Referrals[referralState]` |
| # Open | int | comma thousands | `COUNTROWS` of open rows in state |
| Avg Days | decimal | 1 decimal | `AVERAGE( BacklogAge )` in state |

Sort: `# Open` desc. Source: `intakeAnalytics.ts:264-274`.

---

## 8. Donut & gauge charts

Layout: 4-column grid (`CentralIntakeTab.tsx:261-289`). Each visual hides itself if its underlying data is absent.

### 8.1 Referrals Received Complete (donut)

| | |
| --- | --- |
| **Source** | `receivedReferralComplete` |
| **Segments** | green = COMPLETE (TRUE), red = INCOMPLETE (FALSE) |
| **Subtitle** | `{pct}% complete · {N} total` (pct = complete / total, 1 decimal) |
| **Hides when** | `(completeCount + incompleteCount) = 0` (`CentralIntakeTab.tsx:89`) |

```dax
CompleteCount   = CALCULATE( COUNTROWS( Referrals ), Referrals[receivedReferralComplete] = TRUE )
IncompleteCount = CALCULATE( COUNTROWS( Referrals ), Referrals[receivedReferralComplete] = FALSE )
CompletePct     = DIVIDE( [CompleteCount], [CompleteCount] + [IncompleteCount] )
```

### 8.2 Patient Preference (donut)

| | |
| --- | --- |
| **Source** | `normalizedPatientPref` (§4.9) |
| **Segments** | one per distinct preference; sorted by count **desc**; cycling color palette (purple → accent → amber → green → blue) |
| **Hides when** | no rows have a non-blank preference |

```dax
PatientPrefCount = COUNTROWS( Referrals )
-- Visual: matrix/donut with Axis = normalizedPatientPref, Values = PatientPrefCount
-- Sort the legend by PatientPrefCount desc
```

### 8.3 Wait 1 gauge

| | |
| --- | --- |
| **Value** | `AVERAGE(wait1)` |
| **Max** | `MAX( 60, CEILING( P90/10, 1 ) * 10 )` — at least 60, otherwise P90 rounded up to nearest 10 |
| **Thresholds** | green ≤ 14 days; amber 14–30; red > 30 |

Source: `CentralIntakeTab.tsx:113-116, 279-282`; threshold constants in `src/components/charts/Gauge.tsx`.

```dax
AvgWait1 = AVERAGE( Referrals[wait1] )

P90Wait1 =
PERCENTILEX.INC(
    FILTER( Referrals, NOT ISBLANK( Referrals[wait1] ) ),
    Referrals[wait1],
    0.9
)

Wait1GaugeMax =
VAR Base = COALESCE( [P90Wait1], [AvgWait1], 0 )
RETURN MAX( 60, CEILING( Base / 10, 1 ) * 10 )
```

### 8.4 Wait 2 gauge

Identical formula with `wait2` columns.

---

## 9. Tabbed tables

The bottom of the tab has two panels:

- **Left panel** (2/3 width) — 4 tabs
- **Right panel** (1/3 width) — 2 tabs

### 9.1 Wait 1 Average & 90th Percentile (left panel, default tab)

| Column | Type | Format | DAX |
| --- | --- | --- | --- |
| Recipient Name | text | left-aligned | `Referrals[recipientName]` (group key) |
| Average | decimal | 2 decimals | `AVERAGE( Referrals[wait1] )` |
| 90th Percentile | decimal | 1 decimal | `PERCENTILEX.INC( ..., wait1, 0.9 )` |
| # Referrals | int | thousands sep | `COUNTROWS( Referrals )` per recipient |

- Sticky **totals row** at the top using overall (non-grouped) `view.avgWait1`, `view.p90Wait1`, `view.wait1Count`. (`CentralIntakeTab.tsx:628-633`)
- Default sort: `avgWait1` **desc**. All four columns sortable.
- Empty state: `"Wait 1 not available — neither wait1Days nor scheduledAppointment present in export."` (`CentralIntakeTab.tsx:595`)
- Footer note: `"Wait 1 = days from referral creation to first scheduled appointment."` (`CentralIntakeTab.tsx:661`)

Source: `intakeAnalytics.ts:212-221`.

```dax
RecipientAvgWait1 = AVERAGE( Referrals[wait1] )
RecipientP90Wait1 =
PERCENTILEX.INC(
    FILTER( Referrals, NOT ISBLANK( Referrals[wait1] ) ),
    Referrals[wait1],
    0.9
)
RecipientCount = COUNTROWS( Referrals )
```

### 9.2 Referral Volume by Month (left panel)

Bar chart, x = month label (formatted "Jan 2025"), y = referral count per month. Built from per-month `total`. Source: `intakeAnalytics.ts:209`.

```dax
ReferralsInMonth = COUNTROWS( Referrals )
-- Visual: clustered column chart, X = MonthLabel, Y = ReferralsInMonth
```

`MonthLabel` derived column on the month dimension:

```dax
MonthLabel = FORMAT( DATE( YEAR(...), MONTH(...), 1 ), "MMM YYYY" )
```

### 9.3 Method Sent by Sender (left panel)

| Column | Format | DAX |
| --- | --- | --- |
| Sent Type | text | `Referrals[referralSource]` (blank → `(Unknown)`) |
| # of Referrals | int | `COUNTROWS( Referrals )` per method |
| % Referrals | percent (1 dec) | method count / total method count across filter |
| # of Referrers | int | `DISTINCTCOUNT( Referrals[referrerName] )` per method |

Sort: `# of Referrals` **desc**. Empty state: `"referralSource not in export."` Source: `intakeAnalytics.ts:223-231`.

```dax
MethodCount      = COUNTROWS( Referrals )
MethodPct        = DIVIDE( [MethodCount], CALCULATE( COUNTROWS( Referrals ), ALLSELECTED( Referrals[referralSource] ) ) )
MethodReferrers  = DISTINCTCOUNT( Referrals[referrerName] )
```

### 9.4 Current Referral Location (appears in left and right panels)

| Column | Format | DAX |
| --- | --- | --- |
| Recipient Name | text | `Referrals[recipientName]` (blank → `(Unknown)`) |
| # Referrals | int | `COUNTROWS( Referrals )` per recipient |

- Sort: `# Referrals` **desc** (`intakeAnalytics.ts:235`).
- Totals row: label `"Totals"`, value = sum of all recipient counts (= total processed in filter window).
- This visual appears as **left panel tab 4** and **right panel tab 2** with identical formula.

```dax
LocationCount = COUNTROWS( Referrals )
LocationTotal = COUNTROWS( Referrals )   -- across all recipients in the current filter
```

### 9.5 Referral Volume by Referrer Name (right panel, default tab)

| Column | Format | DAX |
| --- | --- | --- |
| Referrer Name | text, **uppercase + trimmed** | normalized `Referrals[referrerName]` |
| # of Referrals | text (see below) | special display rule |

**Display rule** (`intakeAnalytics.ts:241`): if a referrer's count is **less than 5**, show the literal string `"< 5 referrals"` instead of the number. This is a privacy threshold.

Sort: Referrer Name **asc** (alphabetical). Empty state: `"referrerName not in export."` Totals row: label `"TOTALS"`, value = total processed across the filter.

```dax
ReferrerCount = COUNTROWS( Referrals )
ReferrerDisplay =
VAR N = [ReferrerCount]
RETURN IF( N < 5, "< 5 referrals", FORMAT( N, "#,##0" ) )
```

Use a calculated table for the normalized referrer name so the small-cell suppression works correctly at every grouping level:

```dax
ReferrerKey = UPPER( TRIM( Referrals[referrerName] ) )
```

---

## 10. Field-presence visibility rules

Each visual hides itself if its underlying field is absent from the export. The application sets these flags during ingest (`referralAnalyticsAccumulator.ts:205-214`).

| Presence flag | Triggered when ANY row has a non-blank value in… | Visuals hidden when flag = false |
| --- | --- | --- |
| `patientId` | `patientId` | "# Unique Patients" KPI shows "—" |
| `wait1` | `wait1Days` OR `scheduledAppointment` | Wait 1 KPI, Wait 1 gauge, Wait 1 recipient table |
| `wait2` | `wait2Days` OR `scheduledAppointment2` | Wait 2 KPI, Wait 2 gauge |
| `cycle` | both `referralInitialCreationDate` AND `initialForwardDate` (on any CI row) | "Avg Referral Processing Cycle" KPI shows "—" |
| `ciProcessing` | same as `cycle` | Entire CI Processing KPI row (Median / P75 / P90) |
| `backlog` | any row has `centralIntakeRef` + `referralInitialCreationDate` but no `initialForwardDate` | Entire backlog section (3 visuals) |
| `preference` | `patientPreference` | Patient Preference donut |
| `complete` | `receivedReferralComplete` | Referrals Received Complete donut |
| `referrer` | `referrerName` | Referrer Name table (right panel) |
| `source` | `referralSource` | Method Sent by Sender table |
| `recipient` | `recipientName` | (recipient grouping; degrades gracefully) |

**PowerBI implementation:** create a one-row "Presence" measure table and use it to drive visual-level filters. Example:

```dax
HasWait1Data =
IF(
    CALCULATE( COUNTROWS( Referrals ),
        NOT ISBLANK( Referrals[wait1Days] ) || NOT ISBLANK( Referrals[scheduledAppointment] ),
        ALL( Referrals )
    ) > 0,
    1, 0
)
```

Hide the Wait 1 visuals when `HasWait1Data = 0` using bookmark switching or report-page visibility.

---

## 11. Helper math (DAX equivalents)

Three small functions used everywhere — the PowerBI team should know their exact semantics.

| JS function | Location | DAX equivalent | Notes |
| --- | --- | --- | --- |
| `mean(arr)` | `intakeAnalytics.ts:81-86` | `AVERAGE( … )` | Returns null/blank on empty input |
| `percentile(arr, p)` | `intakeAnalytics.ts:88-97` | `PERCENTILE.INC( …, p/100 )` or `PERCENTILEX.INC` | **Linear interpolation.** Matches Excel `PERCENTILE.INC` |
| `diffDays(later, earlier)` | `intakeAnalytics.ts:40-46` | For whole days: `DATEDIFF( earlier, later, DAY )`. For **fractional** days (cycle only): `DATEDIFF( earlier, later, SECOND ) / 86400.0` | Cycle measurement needs sub-day precision |

> **Critical:** the application uses **arithmetic mean** (not median) for averages on KPI cards and tables — only the dedicated CI Processing percentile cards use median/P75/P90. Don't substitute `MEDIAN(...)` for `AVERAGE(...)`.

---

## 12. End-to-end worked example

Walk one row through the entire pipeline so the PowerBI team can validate their build.

### Raw row (as it appears in the Ocean Excel export)

| Column | Raw value |
| --- | --- |
| referralRef | `REF-A001` |
| referralCreationDate | `45823` *(Excel serial)* |
| referralInitialCreationDate | `2025-06-15T09:00:00-04:00` |
| initialForwardDate | `2025-06-15T13:00:00-04:00` |
| referralDeleted | `FALSE` |
| patientId | `PAT-7788` |
| recipientName | `  Dr. Jane Doe Clinic ` |
| referrerName | `john smith` |
| referralSource | `Email` |
| referralState | `ACCEPTED` |
| centralIntakeRef | `CI-555` |
| wait1Days | *(blank)* |
| scheduledAppointment | `2025-07-20` |
| wait2Days | `21` |
| scheduledAppointment2 | *(blank)* |
| patientPreference | `first available` |
| receivedReferralComplete | `true` |

### Step 1 — Normalization (§3)

| Field | Normalized value | Rule |
| --- | --- | --- |
| referralCreationDate | `2025-06-15` | §3.2 Excel serial → ISO (45823 → 2025-06-15) |
| referralInitialCreationDate | `2025-06-15T09:00:00-04:00` *(unchanged)* | §3.3 timestamp preserved |
| initialForwardDate | `2025-06-15T13:00:00-04:00` | §3.3 |
| referralDeleted | `false` (logical) | §3.4 |
| receivedReferralComplete | `true` (logical) | §3.4 |
| wait1Days | `null` | §3.5 blank → null |
| wait2Days | `21` | §3.5 |
| recipientName | `Dr. Jane Doe Clinic` | §3.7 trim |
| referrerName | `JOHN SMITH` | §3.7 trim + upper |
| referralSource | `Email` | §3.7 trim |

Row passes §3.6 (not deleted, date valid) → kept.

### Step 2 — Derived columns (§4)

| Derived field | Value | Rule |
| --- | --- | --- |
| month | `2025-06` | §4.1 |
| fiscalYear | `FY2025-26` | §4.2 (Jun → FY starting Apr 2025) |
| quarter | `FY2025-26 Q1` | §4.3 (Jun is Q1) |
| isoWeek | `2025-06-09` | §4.4 (Monday of week containing Sun 2025-06-15) |
| wait1 | `35` *(days)* | §4.5 fallback: `2025-07-20 − 2025-06-15` |
| wait2 | `21` | §4.6 wait2Days populated |
| cycleDays | `0.1667` | §4.7 `(13:00 − 09:00)/24h = 4/24 = 0.1667` |
| isOpenCI | `false` | §4.8 (initialForwardDate is present) |
| normalizedPatientPref | `First Available Surgeon` | §4.9 (contains "first") |

### Step 3 — Bucketing

Row lands in **month bucket `2025-06`** (FY2025-26 Q1, week 2025-06-09). It contributes:

- `+1` to `total` (KPI 6.1)
- `+1` to `patientIds` set with `PAT-7788` (KPI 6.2)
- `+0.1667` to `cycleDays` array (KPI 6.3, 6.6–6.8 ; donut/gauge n/a)
- `+35` to `wait1Days` array (KPI 6.4, gauge 8.3, table 9.1)
- `+21` to `wait2Days` array (KPI 6.5, gauge 8.4)
- `+1` to `completeCount` (donut 8.1)
- `+1` to `patientPref["First Available Surgeon"]` (donut 8.2)
- `+1` to `byRecipient["Dr. Jane Doe Clinic"].count` with its waits (table 9.1, 9.4)
- `+1` to `byReferrer["JOHN SMITH"]` (table 9.5)
- `+1` to `bySentType["Email"].count` and adds `"JOHN SMITH"` to its referrer set (table 9.3)
- Does **not** contribute to backlog (isOpenCI = false)

### Step 4 — Validation in PowerBI

After building the model:

- Set FY = `FY2025-26`, no other filter → "# Referrals Processed" should include this row.
- Set Quarter = `FY2025-26 Q1` → still included.
- Set Month = `Jun 2025` → still included.
- Set Week = `2025-06-09` → still included.
- Set Month = `Jul 2025` → row should be **excluded**.

Also confirm the global Initial Referral Target filter (§5.1) composes correctly:

- Add the row's `initialReferralTargetRef` value to the Initial Referral Target slicer (along with no FY filter) → row is included.
- Select a *different* `initialReferralTargetRef` in the slicer → row should be **excluded** from every Central Intake visual, regardless of the FY/Q/M/W cascade.

If at any step the result deviates, walk back through §3 and §4 (or §5 for slicer behavior) to find the mismatch.

---

## 13. Appendix: code cross-reference

Quick lookup table — for every visual, find the exact lines of code that produce it.

| Visual / metric | Code location |
| --- | --- |
| Global filter: Initial Referral Target (UI) | `App.tsx:50-51, 80-81, 228`; options built in `referralAnalytics.ts:132-134` / `referralAnalyticsAccumulator.ts:138-139, 445` |
| Global filter: Initial Referral Target (applied) | `file-parser.worker.ts:294-349` (specifically line 344) |
| Tab-level cascade (FY/Q/M/W) UI | `CentralIntakeTab.tsx:125-176` |
| KPI: # Referrals Processed | `CentralIntakeTab.tsx:180`; `intakeAnalytics.ts:181, 280` |
| KPI: # Unique Patients | `CentralIntakeTab.tsx:181-186`; `intakeAnalytics.ts:182, 281` |
| KPI: Avg Processing Cycle | `CentralIntakeTab.tsx:187-192`; `intakeAnalytics.ts:282` |
| KPI: Wait 1 count | `CentralIntakeTab.tsx:193-198`; `intakeAnalytics.ts:292` |
| KPI: Wait 2 count | `CentralIntakeTab.tsx:199-204`; `intakeAnalytics.ts:293` |
| KPI: CI Processing — Median | `CentralIntakeTab.tsx:209-214`; `intakeAnalytics.ts:283` |
| KPI: CI Processing — P75 | `CentralIntakeTab.tsx:215-220`; `intakeAnalytics.ts:284` |
| KPI: CI Processing — P90 | `CentralIntakeTab.tsx:221-226`; `intakeAnalytics.ts:285` |
| Backlog card (count + avg) | `CentralIntakeTab.tsx:232-239`; `intakeAnalytics.ts:245-250, 287-288` |
| Backlog Age Distribution | `CentralIntakeTab.tsx:240-246`; `intakeAnalytics.ts:252-262` |
| Backlog by Referral State | `CentralIntakeTab.tsx:247-256`; `intakeAnalytics.ts:264-274` |
| Donut: Received Complete | `CentralIntakeTab.tsx:269-273, 91-96` |
| Donut: Patient Preference | `CentralIntakeTab.tsx:274-278, 98-111`; `intakeAnalytics.ts:99-113` |
| Gauge: Wait 1 | `CentralIntakeTab.tsx:279-283, 113-116`; `Gauge.tsx` |
| Gauge: Wait 2 | `CentralIntakeTab.tsx:284-288, 117-120` |
| Table: Wait 1 by Recipient | `CentralIntakeTab.tsx:320-334, 578-665`; `intakeAnalytics.ts:212-221` |
| Chart: Volume by Month | `CentralIntakeTab.tsx:335-345`; `intakeAnalytics.ts:209` |
| Table: Method Sent by Sender | `CentralIntakeTab.tsx:347-363`; `intakeAnalytics.ts:223-231` |
| Table: Current Location (left) | `CentralIntakeTab.tsx:365-380`; `intakeAnalytics.ts:233-235` |
| Table: Volume by Referrer | `CentralIntakeTab.tsx:405-423`; `intakeAnalytics.ts:237-243, 317-318` |
| Table: Current Location (right) | `CentralIntakeTab.tsx:425-439` (same data as left) |
| Per-row ingestion (intake) | `referralAnalyticsAccumulator.ts:201-328` |
| Aggregation across buckets | `intakeAnalytics.ts:147-307` (`mergeMonthBuckets`) |
| Field presence detection | `referralAnalyticsAccumulator.ts:205-214`; `types.ts:319-331` |
| Header → canonical name map | `constants.ts:80-143` |
| Used-fields list | `constants.ts:169-185` |
| Date / number / boolean parsing | `intakeAnalytics.ts:40-79`; `utils.ts:39-48` |
| Fiscal year / quarter / ISO week | `intakeAnalytics.ts:10-38` |
| Percentile / mean | `intakeAnalytics.ts:81-97` |
| Patient preference normalization | `intakeAnalytics.ts:99-113` |

---

*End of document.*
