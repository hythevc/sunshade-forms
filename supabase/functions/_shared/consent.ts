// Consent + unsubscribe suppression rules for contact upserts.
// Pure logic shared by the form-submit edge function and unit tests.

export interface ConsentRecord {
  consent_given_at: string | null;
  consent_version: string | null;
  consent_source: string | null;
}

export interface ContactLike {
  id: string;
  subscription_status: "subscribed" | "unsubscribed";
  consent_given_at: string | null;
  consent_version: string | null;
  consent_source: string | null;
}

export interface ContactPatch {
  subscription_status?: "subscribed" | "unsubscribed";
  consent_given_at?: string;
  consent_version?: string;
  consent_source?: string;
}

/**
 * Decide how a contact record should be updated when a form submission
 * mentions consent. Rules:
 *  - Subscription (status "subscribed") requires explicit consent now.
 *  - If the email is suppressed (e.g. previously unsubscribed), it can never
 *    be re-subscribed by a form submission — suppression wins.
 *  - Consent timestamps are only written when consent is explicitly given.
 */
export function resolveContactUpdate(opts: {
  existing: ContactLike | null;
  wantsConsent: boolean;
  consentVersion: string | null;
  consentSource: string;
  suppressed: boolean;
  now: string;
}): { patch: ContactPatch; subscribed: boolean; suppressed: boolean } {
  const { existing, wantsConsent, consentVersion, consentSource, suppressed, now } = opts;

  if (!wantsConsent) {
    return { patch: {}, subscribed: false, suppressed };
  }

  if (suppressed) {
    // Never re-subscribe a suppressed email from a public form.
    return {
      patch: {},
      subscribed: false,
      suppressed: true,
    };
  }

  return {
    patch: {
      subscription_status: "subscribed",
      consent_given_at: now,
      consent_version: consentVersion ?? "v1",
      consent_source: consentSource,
    },
    subscribed: true,
    suppressed: false,
  };
}
