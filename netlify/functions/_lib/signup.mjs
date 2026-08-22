/**
 * What a form submission means, in EmailOctopus terms.
 *
 * Kept apart from submission-created.mjs on purpose: this file is pure — data
 * in, data out, no network, no environment — so it can be run and checked
 * without deploying anything. `node --test netlify/functions/_lib/signup.test.mjs`
 * covers the consent rule, which is the one piece here that has legal weight
 * and the one piece that is invisible until it is already wrong.
 */

/**
 * Which brand this site speaks for. Overridable so this exact folder can be
 * copied to the Mini Barn Market and Farmstand.TV sites with no code change —
 * only a different EMAILOCTOPUS_BRAND value in their Netlify settings.
 */
export const brand = () => (process.env.EMAILOCTOPUS_BRAND || "farmstandtv").trim();

/**
 * Forms that ARE a subscription. Submitting one is the request to be emailed;
 * the button says "Send me the map" and the fine print underneath already
 * promises one or two emails a month and a one-click unsubscribe.
 */
const SUBSCRIBE_FORMS = new Set(["newsletter"]);

/**
 * Forms that are NOT a subscription, but carry an opt-in box.
 *
 * ⚠ CONSENT. Someone asking whether the barn is free in September has not
 * asked to be marketed to. These forms only ever produce a contact when the
 * box was actually ticked, and the box ships unticked. Do not "simplify" this
 * by treating an inquiry as a signup: the cost is not a stern email, it is
 * spam complaints against the sending domain, and that reputation is shared
 * by all three brands on the one EmailOctopus account.
 */
const CONSENT_FORMS = new Set(["group-inquiry"]);

/** The checkbox ships unticked, so an absent value means no. Only a real yes counts. */
function consented(data) {
  const v = String(data["email-opt-in"] ?? "").trim().toLowerCase();
  return v === "yes" || v === "on" || v === "true";
}

/** "Red Barn Ranch — sleeps 20" is the same audience as "Red Barn Ranch". */
function property(data) {
  const raw = String(data.property || "").trim();
  if (!raw) return "";
  const name = raw.split(/[—–-]/)[0].trim();
  if (/not sure/i.test(raw) || /^both/i.test(name)) return "";
  return name;
}

/**
 * Turn a verified submission into the contact to upsert, or null to ignore it.
 *
 * Returning null is a normal outcome, not a failure — most of what arrives
 * here (an unticked inquiry, a form we do not sync) is meant to stop.
 */
export function contactFrom(formName, data = {}) {
  const form = String(formName || "").trim();
  const email = String(data.email || "").trim();
  if (!email) return null;

  const isSubscribe = SUBSCRIBE_FORMS.has(form);
  const isConsent = CONSENT_FORMS.has(form);
  if (!isSubscribe && !isConsent) return null;
  if (isConsent && !consented(data)) return null;

  const tags = [brand()];

  // The hidden `source` field every form already carries — "footer-home",
  // "farmstand-map-page" and so on. It cost nothing to keep and it is the only
  // way to ever answer which band on which page is actually earning signups.
  if (data.source) tags.push("source-" + data.source);

  const prop = property(data);
  if (prop) tags.push(prop);

  if (isConsent) tags.push(form, "lead");

  return {
    email,
    firstName: String(data["first-name"] || data.name || "").trim().split(/\s+/)[0] || "",
    tags,
    // Single opt-in: they typed the address and pressed a button that said
    // send it to me, so the welcome email carries the map instead of a
    // confirmation link that a third of them would never click.
    status: "subscribed",
  };
}
