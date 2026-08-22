/**
 * GET /api/emailoctopus?key=ADMIN_PASSWORD
 *
 * The "is it switched on?" check, and the way to find the list ID during
 * setup without hunting through the EmailOctopus UI. Open it in a browser.
 *
 * It answers three questions in order, because that is the order they fail in:
 *   1. Are the environment variables set?
 *   2. Does the API key actually work?
 *   3. Is EMAILOCTOPUS_LIST_ID one of the lists on this account?
 *
 * It lists every list with its ID, which is what makes it useful before the
 * list ID is set — paste the one you want into Netlify and reload.
 *
 * WHY IT IS GATED, GIVEN LIST IDs ARE NOT SECRET
 * A list ID appears in the public embed code of any EmailOctopus form, so it
 * is not a credential. Subscriber counts and the names of lists you have not
 * launched yet are still nobody else's business, and an ungated endpoint that
 * proves an EmailOctopus account exists here is free reconnaissance. It costs
 * one line to gate, so it is gated.
 *
 * It FAILS CLOSED: with no ADMIN_PASSWORD set in Netlify, nobody gets in,
 * including you. That is deliberate — the alternative is a window where a
 * half-finished deploy is wide open.
 *
 * The key travels as a query string, which means it lands in browser history.
 * That is a considered trade: the person who needs this does not use a
 * terminal, and the password guards a read-only status page, not the account.
 * Do not reuse ADMIN_PASSWORD anywhere that matters.
 */
import { configured, getLists, listId, describe } from "./_lib/emailoctopus.mjs";

const json = (obj, status = 200) =>
  Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

/** Constant time, so the endpoint cannot be used to guess the password. */
function secretOk(given) {
  const want = process.env.ADMIN_PASSWORD || "";
  if (!want) return false;
  const a = new TextEncoder().encode(String(given || ""));
  const b = new TextEncoder().encode(want);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export default async (req) => {
  const url = new URL(req.url);
  const given = url.searchParams.get("key") || req.headers.get("x-admin-password");

  if (!process.env.ADMIN_PASSWORD) {
    return json({ error: "ADMIN_PASSWORD is not set in Netlify, so this page stays shut." }, 503);
  }
  if (!secretOk(given)) return json({ error: "Wrong key." }, 401);

  const cfg = configured();
  const out = {
    ready: false,
    apiKeySet: !!process.env.EMAILOCTOPUS_API_KEY,
    listIdSet: !!listId(),
    missing: cfg.missing,
    next: null,
  };

  if (!out.apiKeySet) {
    out.next = "Add EMAILOCTOPUS_API_KEY in Netlify → Site configuration → Environment variables, then redeploy.";
    return json(out);
  }

  let res;
  try {
    res = await getLists();
  } catch (err) {
    out.next = "Could not reach EmailOctopus: " + String(err?.message || err);
    return json(out, 502);
  }

  if (!res.ok) {
    out.next =
      res.status === 401 || res.status === 403
        ? "EmailOctopus rejected the API key. Generate a fresh one and replace EMAILOCTOPUS_API_KEY."
        : "EmailOctopus said: " + describe(res);
    return json(out, 502);
  }

  const lists = (res.payload?.data || []).map((l) => ({
    id: l.id,
    name: l.name,
    subscribed: l.counts?.subscribed ?? null,
    thisIsTheOneInUse: l.id === listId(),
  }));
  out.lists = lists;

  if (!out.listIdSet) {
    out.next =
      lists.length
        ? `Copy the id of the list you want and set EMAILOCTOPUS_LIST_ID to it in Netlify, then redeploy.`
        : "This account has no lists yet. Create one in EmailOctopus first.";
    return json(out);
  }

  if (!lists.some((l) => l.thisIsTheOneInUse)) {
    out.next = `EMAILOCTOPUS_LIST_ID is set to "${listId()}", which is not a list on this account. Check it against the ids above.`;
    return json(out);
  }

  out.ready = true;
  out.automationIdSet = !!(process.env.EMAILOCTOPUS_AUTOMATION_ID || "").trim();
  out.next = out.automationIdSet
    ? "Wired up, and this site names its own welcome automation."
    : "Wired up. The welcome email is expected to fire from EmailOctopus's own \"joined the list\" trigger — make sure that automation has a tag condition, or set EMAILOCTOPUS_AUTOMATION_ID here instead.";

  // ?selftest=1 — the real round trip, in a browser.
  //
  // tools/eo-provision.mjs does this from a terminal, which is the wrong shape
  // for the person who actually owns this site: the handover notes say plainly
  // that they do not run commands. Same check, same guarantees, reachable from
  // a phone.
  //
  // It is opt-in rather than part of the normal status read because it writes:
  // a contact is created and then deleted, and a status page you refresh out of
  // habit should not be touching the real list every time.
  if (url.searchParams.get("selftest") === "1") {
    out.selftest = await selftest();
    out.ready = out.selftest.tagsApplied === true;
    out.next = out.ready
      ? "Verified end to end. Tagging works against the live API — submit a real signup form and it will appear on the list within a few seconds."
      : "The round trip did not come back clean. See selftest below.";
  } else {
    out.tip = "Add &selftest=1 to prove it end to end — adds a test contact, checks the tags stuck, deletes it again.";
  }

  return json(out);
};

/**
 * Add a contact with all three brand tags, read it back, delete it.
 *
 * The read-back is the entire point. A wrong tag format is accepted with a 200
 * and applies nothing, so "the request succeeded" proves nothing at all — only
 * looking at the stored contact can tell you the tags are really there.
 */
async function selftest() {
  const { upsertContact, apiKey } = await import("./_lib/emailoctopus.mjs");
  const BRANDS = ["farmhousegetaways", "minibarnmarket", "farmstandtv"];
  const email = `selftest+${listId().slice(0, 8)}@farmhousegetaways.com`;
  const r = { email, added: false, tagsApplied: null, tagsSeen: [], cleanedUp: false, note: null };

  const added = await upsertContact({ email, firstName: "Selftest", tags: BRANDS });
  if (!added.ok) {
    r.note = "Could not add the test contact: " + describe(added);
    return r;
  }
  r.added = true;

  const { createHash } = await import("node:crypto");
  const id = createHash("md5").update(email.toLowerCase()).digest("hex");
  const base = "https://api.emailoctopus.com";
  const headers = { authorization: "Bearer " + apiKey() };

  try {
    const res = await fetch(`${base}/lists/${listId()}/contacts/${id}`, { headers });
    if (res.ok) {
      const c = await res.json();
      const seen = Array.isArray(c.tags) ? c.tags : Object.keys(c.tags || {});
      r.tagsSeen = seen;
      const missing = BRANDS.filter((b) => !seen.includes(b));
      r.tagsApplied = missing.length === 0;
      if (missing.length) {
        r.note = "These tags did not stick: " + missing.join(", ") +
                 ". PUT needs tags as an object map, not an array — if you are seeing this, the API contract moved.";
      }
    } else {
      r.note = `Added the contact but could not read it back (HTTP ${res.status}).`;
    }
  } catch (err) {
    r.note = "Could not read the contact back: " + String(err?.message || err);
  }

  // Always clean up. A status page must not leave fake subscribers behind.
  try {
    const del = await fetch(`${base}/lists/${listId()}/contacts/${id}`, { method: "DELETE", headers });
    r.cleanedUp = del.ok || del.status === 404;
  } catch { r.cleanedUp = false; }
  if (!r.cleanedUp) r.note = (r.note ? r.note + " " : "") + `Could not remove ${email} — delete it by hand.`;

  return r;
}
