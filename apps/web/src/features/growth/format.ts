export const vnd = (n: number) => `${new Intl.NumberFormat("vi-VN").format(n)} ₫`;
export const STATUS_LABEL: Record<string, string> = {
  lead: "New lead",
  placed: "Placement done",
  enrolled: "Enrolled and paid · waiting for staff",
  confirmed: "Confirmed · reward issued",
  rejected: "Not counted",
};
export const FLAG_LABEL: Record<string, string> = {
  self_referral: "Self-referral",
  same_household: "Same household",
  duplicate: "Duplicate (already a learner or lead here)",
  already_rewarded: "Already rewarded once",
};
