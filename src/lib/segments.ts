export interface SegmentFilter {
  tags: string[];
  sources: string[];
  subscription_status: "subscribed" | "unsubscribed" | "any";
}

export interface SegmentableContact {
  email_norm: string;
  tags: string[];
  source: string;
  subscription_status: string;
}

export function normalizeFilter(raw: unknown): SegmentFilter {
  const r = (raw ?? {}) as Partial<SegmentFilter>;
  return {
    tags: Array.isArray(r.tags) ? r.tags : [],
    sources: Array.isArray(r.sources) ? r.sources : [],
    subscription_status: r.subscription_status === "unsubscribed" || r.subscription_status === "any" ? r.subscription_status : "subscribed",
  };
}

export function matchesSegment(c: SegmentableContact, f: SegmentFilter): boolean {
  if (f.subscription_status !== "any" && c.subscription_status !== f.subscription_status) return false;
  if (f.tags.length && !f.tags.every((t) => c.tags.includes(t))) return false;
  if (f.sources.length && !f.sources.includes(c.source)) return false;
  return true;
}

/** Campaign recipients: subscribed, unsuppressed, matching the segment. */
export function campaignRecipients<T extends SegmentableContact>(contacts: T[], f: SegmentFilter | null, suppressed: Set<string>): T[] {
  const filter = f ?? { tags: [], sources: [], subscription_status: "subscribed" as const };
  return contacts.filter(
    (c) => c.subscription_status === "subscribed" && !suppressed.has(c.email_norm) && matchesSegment(c, { ...filter, subscription_status: "subscribed" }),
  );
}
