/**
 * What a form submission means, in EmailOctopus terms.
 *
 * Kept apart from submission-created.mjs on purpose: this file is pure — data
 * in, data out, no network, no environment — so it can be run and checked
 * without deploying anything. `node --test netlify/functions/_lib/signup.test.mjs`
 * covers the consent rule, which is the one piece here that has legal weight
 * and the one piece that is invisible until it is already wrong.
 *
 * EVERY FORM PRODUCES A CONTACT. CONSENT DECIDES THE STATUS, NOT WHETHER IT IS
 * STORED.
 * Until 22 Aug 2026 an inquiry with the opt-in box left unticked produced
 * nothing at all, so the address existed only in the Netlify inbox. The owner
 * asked for one place holding everyone who has ever written in, filterable by
 * which form they came through. That is what this now does — but "stored" and
 * "may be emailed a campaign" are two different things and this file is where
 * they are kept apart:
 *
 *   consented   -> status "subscribed"    — on the list, will be mailed
 *   not         -> status "unsubscribed"  — on the list, will NEVER be mailed
 *
 * EmailOctopus will not include an unsubscribed contact in a campaign. So the
 * promise printed next to the tick box still holds exactly: someone asking
 * whether the barn is free in September does not get marketed to. They are
 * simply findable, which they already were in the Netlify inbox.
 *
 * ⚠ Do not "simplify" this by sending everyone as subscribed. The cost is not
 * a stern email, it is spam complaints against the sending domain, and that
 * reputation is shared by all three brands on the one EmailOctopus account.
 */

/**
 * Which brand this site speaks for. Overridable so this exact folder can be
 * copied to the Mini Barn Market and Farmstand.TV sites with no code change —
 * only a different EMAILOCTOPUS_BRAND value in their Netlify settings.
 */
export const brand = () => {
  const explicit = (process.env.EMAILOCTOPUS_BRAND || "").trim();
  if (explicit) return explicit;
  // SITE_LABEL is already set on all three sites for the form alerts, so it is
  // a far safer fallback than a hardcoded name: this folder is copied verbatim
  // between the sites, and forgetting EMAILOCTOPUS_BRAND on one of them would
  // otherwise file that site's contacts under Farmhouse Getaways — wrong, and
  // completely invisible until a send went to the wrong people.
  const label = (process.env.SITE_LABEL || "").trim();
  return label || "farmhousegetaways";
};

/**
 * Forms that ARE a subscription. Submitting one is the request to be emailed;
 * the button says "Send me the map" and the fine print underneath already
 * promises one or two emails a month and a one-click unsubscribe. No tick box
 * is needed or wanted — pressing the button IS the tick.
 */
const SUBSCRIBE_FORMS = new Set(["newsletter"]);

/** Forms where somebody is asking about coming to stay. */
const LEAD_FORMS = new Set(["group-inquiry"]);

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
 * The first name, from whichever field this particular form happens to use.
 * The list greets people; it does not file them, so one name is enough.
 */
function firstNameFrom(data) {
  const raw = String(
    data["first-name"] || data["owner-first"] || data.name || ""
  ).trim();
  return raw.split(/\s+/)[0] || "";
}

/**
 * Turn a verified submission into the contact to upsert, or null to ignore it.
 *
 * Null now means only one thing: there was no email address to store. Every
 * form that carries one produces a contact.
 */
export function contactFrom(formName, data = {}) {
  const form = String(formName || "").trim();
  const email = String(data.email || "").trim();
  if (!email) return null;

  // A tick box that was ticked, or a form that is itself the request to be
  // emailed. Anything else is stored but never mailed.
  const consent = SUBSCRIBE_FORMS.has(form) || consented(data);

  const tags = [brand()];

  // Which form they came through — the thing to filter on. Prefixed so it can
  // never collide with a brand or a property name, and so every one of them
  // sorts together in the EmailOctopus tag list.
  if (form) tags.push("form-" + form);

  // The hidden `source` field every form already carries — "footer-home",
  // "farmstand-map-page" and so on. It cost nothing to keep and it is the only
  // way to ever answer which band on which page is actually earning signups.
  if (data.source) tags.push("source-" + data.source);

  const prop = property(data);
  if (prop) tags.push(prop);

  // An inquiry is a lead whether or not they agreed to be emailed: somebody
  // asked about staying here, and that is worth filtering on its own.
  //
  // Only these forms, though. A farm stand owner adding their stand to the map
  // is not a booking lead, and tagging them as one would put them in front of
  // whoever next filters the list for people to follow up with.
  if (LEAD_FORMS.has(form)) tags.push("lead");

  return {
    email,
    firstName: firstNameFrom(data),
    tags,
    // Single opt-in where consent exists: they typed the address and pressed a
    // button that said send it to me, so the welcome email carries the map
    // instead of a confirmation link that a third of them would never click.
    status: consent ? "subscribed" : "unsubscribed",
    // Passed through so the caller can tell a stored-only contact from a real
    // signup without re-deriving the rule — the welcome automation must only
    // ever run for the second kind.
    consent,
  };
}
