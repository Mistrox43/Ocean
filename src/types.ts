// ── Header Diagnostics & Parsing ──────────────────────────────────────────────

export type HeaderDiag = {
  raw: string;
  mapped: string;
  inMap: boolean;
  sample: string;
};

export type ParseResult = {
  rows: Record<string, string>[];
  headerDiag: HeaderDiag[];
  error?: string;
};

// ── Sort ─────────────────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc';

// ── Listing Statistics ───────────────────────────────────────────────────────

export interface GeoDataRow {
  region: string;
  total: number;
  enabled: number;
  rate: number;
}

export interface ListingStats {
  total: number;
  eRefEnabled: number;
  eConEnabled: number;
  approved: number;
  pending: number;
  ccEnabled: number;
  sekStored: number;
  contributing: number;
  testMode: number;
  trustee: number;
  nonTrustee: number;
  unspecTrustee: number;
  notAccepting: number;
  typeMap: Record<string, number>;
  geoData: GeoDataRow[];
}

// ── Site Statistics ──────────────────────────────────────────────────────────

export interface SiteStats {
  total: number;
  validated: number;
  pmEnabled: number;
  obEnabled: number;
  totalFees: number;
  totalPmLic: number;
  totalObLic: number;
  emrMap: Record<string, number>;
  withListings: number;
}

// ── User Statistics ──────────────────────────────────────────────────────────

export interface TimelinePoint {
  label: string;
  value: number;
  cumulative: number;
}

export interface UserStats {
  total: number;
  valid: number;
  roleMap: Record<string, number>;
  timeline: TimelinePoint[];
  versionMap: Record<string, number>;
  siteUserCount: Record<string, number>;
}

// ── Site Maturity ────────────────────────────────────────────────────────────

export interface SiteMaturityRow {
  siteNum: string;
  siteName: string;
  total: number;
  eRefEnabled: number;
  eConEnabled: number;
  ccEnabled: number;
  userCount: number;
  validated: boolean;
  emr: string;
  adoptionRate: number;
}

// ── Staffing ─────────────────────────────────────────────────────────────────

export interface StaffingListingDetail {
  ref: string;
  title: string;
  raClinCount: number;
  eReferrals: string;
  eConsults: string;
  listingType: string;
  claimedByUser: string;
  clinicianProfId: string;
}

export interface StaffingRow {
  siteNum: string;
  siteName: string;
  emr: string;
  userCount: number;
  raClinTotal: number;
  delta: number;
  absDelta: number;
  listingCount: number;
  details: StaffingListingDetail[];
}

// ── Data Quality ─────────────────────────────────────────────────────────────

export interface DataQualityCoverage {
  userToSite: {
    uniqueSNs: number;
    matched: number;
    orphaned: number;
    linksTotal: number;
    linksMatched: number;
    linksOrphaned: number;
  };
  listingToSite: {
    uniqueSNs: number;
    matched: number;
    orphaned: number;
    linksMatched: number;
    linksOrphaned: number;
  };
  userToListing: {
    inListings: number;
    notInListings: number;
  };
}

export interface OrphanedUser {
  name: string;
  clinicianType: string;
  siteNumbers: string;
  dateOfAgreement: string;
}

export interface OrphanedSiteNumber {
  siteNumber: string;
  userCount: number;
  listingCount: number;
  sampleUsers: string[];
}

export interface BlankUser {
  name: string;
  clinicianType: string;
  dateOfAgreement: string;
  email: string;
}

export interface DataQualityResult {
  coverage: DataQualityCoverage;
  orphanedUsers: OrphanedUser[];
  partialOrphanUsers: number;
  orphanedSNs: OrphanedSiteNumber[];
  blankUsers: BlankUser[];
}

// ── Referral Analytics ───────────────────────────────────────────────────────

export interface PctChange {
  val: string;
  num: number;
}

export interface WeeklyData {
  label: string;
  total: number;
  test: number;
  nonTest: number;
  senders: number;
  receivers: number;
}

export interface TargetListingRow {
  ref: string;
  title: string;
  count: number;
}

export interface TargetSiteRow {
  siteNum: string;
  siteName: string;
  totalRefs: number;
  uniqueSenders: number;
  states: Record<string, number>;
  listings: TargetListingRow[];
}

export interface SourceSiteRow {
  siteNum: string;
  siteName: string;
  totalRefs: number;
  uniqueTargets: number;
  uniqueUsers: number;
}

export interface SenderSrcSite {
  siteNum: string;
  siteName: string;
  count: number;
}

export interface SenderRow {
  userName: string;
  fullName: string;
  clinicianType: string;
  profId: string;
  totalRefs: number;
  uniqueTargets: number;
  uniqueListings: number;
  isUnknown: boolean;
  srcSites: SenderSrcSite[];
}

export interface LabelValue {
  label: string;
  value: number;
}

export interface ReferralAnalytics {
  total: number;
  distinctRefs: number;
  uniqueSendingSites: number;
  uniqueTargetSites: number;
  uniqueSenders: number;
  uniqueProfIds: number;
  uniqueTargetRefs: number;
  curMCount: number;
  curM: string;
  lastFullM: string;
  lastFullCount: number;
  chg1: PctChange;
  cmp1M: string;
  cmp1Count: number;
  chg3: PctChange;
  cmp3M: string;
  cmp3Count: number;
  chg12: PctChange;
  cmp12M: string;
  cmp12Count: number;
  earliestDate: string;
  fhirCount: number;
  fhirPct: number;
  timeline: TimelinePoint[];
  weekly: WeeklyData[];
  byTarget: TargetSiteRow[];
  bySource: SourceSiteRow[];
  bySender: SenderRow[];
  byRegion: LabelValue[];
  byService: LabelValue[];
  byClinType: LabelValue[];
  byEmrSent: LabelValue[];
  byEmrRecv: LabelValue[];
}
