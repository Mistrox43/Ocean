# Ocean eReferral Adoption Dashboard

Interactive analytics dashboard for tracking Ocean eReferral adoption across sites, listings, users, and referral activity. Built for Regional Authority capacity.

## Features

- **8 tabs**: Overview, Listings & eReferral, Onboarding Timeline, Geographic, Site Maturity, Staffing, Referral Activity, Data Quality
- **4 data sources**: Listings, Sites, Users, and Referral Analytics export files
- **Global test listing filter** with persistent banner
- **Interactive charts**: Hover tooltips on all bar charts, area charts, and donut charts
- **Expandable detail rows**: Staffing reconciliation, referral target sites, and sender source sites
- **Column mapping diagnostic**: Data quality tab with field definitions, mapping status, and sample values
- **Cross-file join analysis**: Coverage matrix, orphaned records, and blank site number detection

## Tech Stack

- React 18 + TypeScript
- Tailwind CSS + shadcn/ui components
- SheetJS (xlsx) loaded via CDN
- Parcel bundler → single self-contained HTML file

## Data Sources

Upload these Regional Authority export files from Ocean:

1. **Export Listings** (.xlsx) — Directory listings with eReferral/eConsult status
2. **Export Sites** (.xlsx) — Ocean site accounts with EMR, licences, validation
3. **Export Users** (.xlsx) — User accounts with agreements and site associations
4. **Referral Analytics** (.xlsx) — Record-level referral transaction data (optional)

Files are joined via **Site Number** with automatic normalization for format inconsistencies.

## Build

```bash
# Install dependencies
pnpm install

# Development
pnpm dev

# Production build (single HTML file)
bash scripts/bundle.sh
```

### Build Process

The build produces a single self-contained HTML file:

1. Parcel bundles React + Tailwind + app code
2. Post-build script injects SheetJS CDN `<script>` tag
3. Output: `ocean-ereferral-dashboard.html` (~475KB)

The SheetJS library is loaded from cdnjs CDN rather than bundled to keep the file size manageable.

## Pre-built Output

`ocean-ereferral-dashboard.html` is the ready-to-use dashboard. Open it in any modern browser — no server required.

## Key Design Decisions

- **Site Number normalization**: `normSN()` strips `.0` suffixes, leading zeros, and whitespace for reliable cross-file joins
- **Boolean handling**: SheetJS returns Excel booleans as lowercase strings (`"true"`); parser normalizes to uppercase `"TRUE"`/`"FALSE"`
- **Date handling**: `fmtDate()` converts Excel serial numbers to ISO dates
- **Test listing filter**: Single `filteredListings` memo cascades to all downstream computations; referral data uses `sentToTestListing` field
- **UTC week bucketing**: Weekly charts use explicit UTC to avoid timezone-related date shifting
