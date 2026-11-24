/*
 * Public course showcase (owner 23/11): a public page (no sign-in) of the organization's Course
 * Studio courses whose PUBLISHED version staff chose to show. SYNTHETIC data only.
 *  - staff with courses:author turn a course's showcase on / off, outside its versions (the
 *    published content stays immutable): the offer (Free / Trial / Paid), the catalog course
 *    (ENG-A2…) enquiries are for, and the learning needs it serves;
 *  - the page ranks courses by FIT FOR WHAT THE VISITOR CHOSE (level, needs, center — never
 *    stored), with the reasons shown; price and commission never rank;
 *  - Paid shows "from X ₫ / term" from the approved tuition of the catalog course; nothing is sold
 *    online;
 *  - the enquiry form takes a display name, a center and needs — no contact details — and creates
 *    an Admissions lead with its origin (course, version, offer, kind). Partners are never sent
 *    anything from here: staff refer a lead to a partner from Admissions.
 */
import type { LearningNeed } from "./admissions.js";
import type { PublicBadge, PublicInstructor } from "./brand.js";

export type ShowcaseOffer = "free" | "trial" | "paid";
export const SHOWCASE_OFFERS: readonly ShowcaseOffer[] = ["free", "trial", "paid"];

/** Staff settings of one course (Course Studio → Public showcase). */
export interface ShowcaseSettings {
  ref: string;
  isPublic: boolean;
  offer: ShowcaseOffer;
  catalogCode: string | null;
  needs: LearningNeed[];
  updatedBy: string | null;
  updatedAt: string | null;
  /** What the public sees now: the latest published version, or null (not published). */
  publishedVersion: number | null;
}

export interface ShowcaseOrg {
  slug: string;
  name: string;
  courses: number;
}

export interface ShowcaseFit {
  points: number;
  reasons: string[]; // plain words: why this course fits what the visitor chose
}

export interface ShowcaseCard {
  ref: string;
  title: string;
  level: string;
  summary: string;
  lessons: number;
  offer: ShowcaseOffer;
  priceFromVnd: number | null; // Paid: the lowest approved tuition per term of the catalog course
  needs: LearningNeed[];
  centers: string[]; // centers where a class of the catalog course runs
  fit: ShowcaseFit;
}

export interface ShowcasePage {
  org: { slug: string; name: string };
  levels: string[];
  centers: string[];
  needs: LearningNeed[];
  courses: ShowcaseCard[];
}

export interface ShowcaseDetail extends ShowcaseCard {
  org: { slug: string; name: string };
  version: number;
  path: { title: string }[]; // lesson titles only — the lesson content stays for learners
  allCenters: string[]; // centers an enquiry may name
  /** The provider: tagline, colors and its verified badges (brand profile, owner 24/11). */
  brand: { tagline: string; primaryColor: string; accentColor: string; badges: PublicBadge[] };
  /** Opted-in teachers of the classes that run the catalog course (verified badges only). */
  instructors: PublicInstructor[];
}

export type ShowcaseEnquiryKind = "consult" | "trial";
export interface ShowcaseEnquiry {
  learnerName: string;
  centerName: string;
  kind: ShowcaseEnquiryKind;
  needs: LearningNeed[];
}
