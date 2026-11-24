/*
 * Brand & provider profile on the public showcase (owner 24/11). SYNTHETIC data only.
 *  - the organization's own profile (tagline, about, brand colors, its centers, its verified
 *    badges) — staff with brand:manage edit it; partners are not shown (leads still go only to
 *    Admissions);
 *  - teachers opt in to their OWN public profile (display name, short bio, verified badges);
 *    staff cannot publish a teacher; turning it off removes it at once; no photo, no contact
 *    details;
 *  - badges are claimed (by staff for the organization, by a teacher for themselves) and then
 *    verified by a DIFFERENT person with brand:manage (maker-checker). A Credly badge is checked
 *    through the CredentialVerifier port — in staging a fake "Credly (mock)" that never calls the
 *    network; a professional certificate is confirmed by hand ("certificate seen"). A real Credly
 *    connection is later work behind its own gate.
 *  - the public sees only verified badges that have not expired, never who verified them.
 */

export type CredentialSource = "credly_mock" | "certificate";
export const CREDENTIAL_SOURCES: readonly CredentialSource[] = ["credly_mock", "certificate"];
export const CREDENTIAL_SOURCE_LABEL: Record<CredentialSource, string> = {
  credly_mock: "Credly (mock)",
  certificate: "Professional certificate",
};

export type CredentialStatus = "claimed" | "verified" | "rejected" | "withdrawn";

/** What a badge issuer's register says about a badge code. */
export type CredentialCheck = "valid" | "revoked" | "expired" | "unknown";

/** Port: look a badge code up at its issuer's register (fake in staging — no network). */
export interface CredentialVerifier {
  readonly source: CredentialSource;
  check(badgeCode: string): Promise<CredentialCheck>;
}

export interface CredentialClaim {
  title: string;
  issuer: string;
  source: CredentialSource;
  badgeCode: string;
  issuedOn: string; // YYYY-MM-DD
  expiresOn: string | null;
}

export interface Credential extends CredentialClaim {
  id: string;
  holder: "org" | "teacher";
  holderName: string; // the organization or the teacher
  status: CredentialStatus;
  expired: boolean; // past its expiry date today
  claimedBy: string;
  claimedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null; // the check made when verified / the reason when rejected or withdrawn
  /** Hints for the screen only — the server decides. */
  mine: boolean; // the viewer claimed it (cannot verify it)
}

export interface BrandProfile {
  tagline: string;
  about: string;
  primaryColor: string; // #rrggbb
  accentColor: string;
  updatedBy: string | null;
  updatedAt: string | null;
}
export type BrandProfileInput = Pick<
  BrandProfile,
  "tagline" | "about" | "primaryColor" | "accentColor"
>;

export interface BrandAdmin {
  org: { slug: string | null; name: string };
  profile: BrandProfile;
  credentials: Credential[];
  /** Read-only: which teachers chose to be public (only the teacher can change it). */
  teachers: { name: string; isPublic: boolean; displayName: string | null }[];
  canManage: boolean;
}

export interface MyPublicProfile {
  name: string;
  isPublic: boolean;
  displayName: string;
  bio: string;
  credentials: Credential[];
}
export type MyPublicProfileInput = Pick<MyPublicProfile, "isPublic" | "displayName" | "bio">;

export interface PublicBadge {
  title: string;
  issuer: string;
  source: CredentialSource;
  badgeCode: string;
  issuedOn: string;
  expiresOn: string | null;
}
export interface PublicInstructor {
  displayName: string;
  bio: string;
  badges: PublicBadge[];
}

export interface PublicBrand {
  org: { slug: string; name: string };
  tagline: string;
  about: string;
  primaryColor: string;
  accentColor: string;
  centers: string[];
  badges: PublicBadge[];
  instructors: PublicInstructor[];
  courses: number;
}

export type BrandResult =
  { ok: true; id?: string } | { ok: false; reason: string; detail?: string };

export const DEFAULT_BRAND_COLORS = { primaryColor: "#1f4e79", accentColor: "#e0a100" } as const;
