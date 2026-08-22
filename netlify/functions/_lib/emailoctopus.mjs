/**
 * The EmailOctopus client. One list, tagged by brand.
 *
 * THE SHAPE OF THE THING
 * Every signup across Farmhouse Getaways, Mini Barn Market and Farmstand.TV
 * lands on a single EmailOctopus list and is told apart by tags. EmailOctopus
 * bills per contact per list, so three lists would charge twice for anyone who
 * signs up on two brands — and most of the people who want the farmstand map
 * are exactly the people who would also want to hear about the barn.
 *
 * Sending to one brand is then a tag filter inside EmailOctopus, which is a
 * dropdown, not a migration.
 *
 * NO KEY LIVES IN THIS REPO.
 * EMAILOCTOPUS_API_KEY and EMAILOCTOPUS_LIST_ID are Netlify environment
 * variables, set in the Netlify UI, the same rule the app's SETUP.md sets for
 * every other credential. If either is missing this module says so plainly
 * rather than failing somewhere further downstream.
 */

import { createHash } from "node:crypto";

const API = "https://api.emailoctopus.com";

export const apiKey = () => (process.env.EMAILOCTOPUS_API_KEY || "").trim();
export const listId = () => (process.env.EMAILOCTOPUS_LIST_ID || "").trim();

/** Is the integration switched on? Used by the check endpoint and the trigger. */
export function configured() {
  const missing = [];
  if (!apiKey()) missing.push("EMAILOCTOPUS_API_KEY");
  if (!listId()) missing.push("EMAILOCTOPUS_LIST_ID");
  return { ok: missing.length === 0, missing };
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: "Bearer " + apiKey(),
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // EmailOctopus returns a JSON problem document on errors, but a gateway
  // hiccup can still hand back HTML. Never let a parse failure masquerade as
  // an API error — the two want completely different responses from us.
  let payload = null;
  const text = await res.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 300) }; }
  }
  return { status: res.status, ok: res.ok, payload };
}

/** Every list on the account, so setup can be told the real IDs. */
export async function getLists() {
  return call("GET", "/lists");
}

/**
 * Add or update one contact.
 *
 * PUT, NOT POST — AND THE TAG FORMAT DIFFERS BETWEEN THEM.
 * POST /contacts is create-only: a second signup from the same address returns
 * 409 and the tags on that second submission are lost. PUT is an upsert, so
 * someone who signed up for the map in March and again from the barn page in
 * August ends up with both source tags instead of an error in the log.
 *
 * The catch is that the two endpoints do not take tags the same way. POST
 * wants an array — ["map"] — and PUT wants an object keyed by tag name with a
 * boolean value, where `false` REMOVES a tag:
 *
 *     "tags": { "farmhousegetaways": true }
 *
 * Hand PUT an array and the request still succeeds. It simply applies no tags
 * at all, silently, and every contact arrives untagged — which would not look
 * broken until the first time someone tried to send to one brand and reached
 * everybody. Hence buildTags() below, and hence this comment.
 */
export async function upsertContact({ email, firstName, tags = [], status = "subscribed" }) {
  const address = String(email || "").trim();
  if (!address) return { ok: false, status: 0, payload: { skipped: "no email address" } };

  const body = { email_address: address, status };

  // FirstName is one of the two fields EmailOctopus creates on every list by
  // default, so it is safe to send without anyone having to add it first.
  // Anything else we know about a signup goes into tags instead of custom
  // fields, for exactly that reason — a tag needs no setup, a field does.
  if (firstName) body.fields = { FirstName: firstName };

  const tagMap = buildTags(tags);
  if (Object.keys(tagMap).length) body.tags = tagMap;

  const res = await call("PUT", `/lists/${listId()}/contacts`, body);
  if (res.ok) return res;

  // A rejected tag or field must never cost us the signup. If the rich version
  // is refused, put the bare address on the list and report the downgrade —
  // an untagged subscriber is a small problem, a lost one is permanent.
  const worthRetrying = (res.status === 400 || res.status === 422) && (body.tags || body.fields);
  if (worthRetrying) {
    const bare = await call("PUT", `/lists/${listId()}/contacts`, { email_address: address, status });
    if (bare.ok) return { ...bare, degraded: describe(res) };
  }
  return res;
}

/**
 * Tag names, cleaned up and turned into the object map PUT expects.
 *
 * Lowercase and hyphenated so that "Red Barn Ranch" typed into a form and
 * "red-barn-ranch" written in code cannot become two different tags that mean
 * the same thing and split the audience in half.
 */
export function buildTags(tags) {
  const out = {};
  for (const raw of tags) {
    if (!raw) continue;
    const tag = String(raw)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
    if (tag) out[tag] = true;
  }
  return out;
}

/**
 * Start an automation for one contact — the auto-responder that carries the map.
 *
 * WHY THIS EXISTS WHEN EMAILOCTOPUS CAN ALREADY TRIGGER ON "JOINED THE LIST"
 * One list serves three brands. A list-join trigger fires for all of them, so
 * a Mini Barn Market signup would get the Farmhouse welcome. EmailOctopus can
 * narrow an automation by tag, and if yours does, leave EMAILOCTOPUS_AUTOMATION_ID
 * unset and let it — that path needs no code and cannot drift.
 *
 * Set the variable and the site names its own automation explicitly instead,
 * which is the only way to be certain the right brand's email goes out.
 *
 * THE API CANNOT BUILD THE AUTOMATION, ONLY START IT. v2 exposes lists,
 * contacts, fields and tags; campaigns are read-only and automations have
 * exactly this one write endpoint. The email itself has to be created in the
 * EmailOctopus UI — see EMAIL.md, which has the copy ready to paste.
 *
 * contact_id is the MD5 of the lowercased address, not the id from the upsert
 * response, so this needs no extra round trip and works for a contact that
 * already existed.
 */
export async function queueAutomation(email, automationId) {
  const id = String(automationId || "").trim();
  if (!id) return { ok: true, skipped: "no automation configured" };

  const contactId = createHash("md5")
    .update(String(email).trim().toLowerCase())
    .digest("hex");

  const res = await call("POST", `/automations/${id}/queue`, { contact_id: contactId });

  // 409 means the contact is already in this automation. That is the correct
  // outcome for a second signup from the same address, not a failure — and it
  // is exactly what stops someone who signs up twice getting the map twice.
  if (res.status === 409) return { ok: true, alreadyQueued: true };
  return res;
}

/** A one-line, log-safe summary of a failed call. Never includes the API key. */
export function describe(res) {
  const p = res.payload || {};
  const detail = p.title || p.detail || p.message || (p.raw ? p.raw : "");
  return `emailoctopus ${res.status}${detail ? " — " + detail : ""}`;
}
