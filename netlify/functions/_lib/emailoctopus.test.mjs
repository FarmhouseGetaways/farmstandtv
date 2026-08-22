/**
 * node --test netlify/functions/_lib/emailoctopus.test.mjs
 *
 * This file exists for one reason: PUT and POST take tags in different shapes,
 * and handing PUT the wrong one fails SILENTLY — 200 OK, contact added, no
 * tags. Nothing about a working signup would look wrong until the first send
 * to "just Mini Barn Market" went to the whole list. So the request body gets
 * asserted, not eyeballed.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildTags, upsertContact, queueAutomation } from "./emailoctopus.mjs";

const realFetch = globalThis.fetch;
let calls = [];

/** Stand in for EmailOctopus and record exactly what we sent it. */
function stubFetch(reply = { status: 200, body: { id: "abc" } }) {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method, body: JSON.parse(opts.body), headers: opts.headers });
    // 204 must have a null body — the Response constructor throws otherwise,
    // and the automation endpoint answers 204 on success.
    const noBody = reply.status === 204 || reply.status === 304;
    return new Response(noBody ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: noBody ? {} : { "content-type": "application/json" },
    });
  };
}

beforeEach(() => {
  calls = [];
  process.env.EMAILOCTOPUS_API_KEY = "test-key";
  process.env.EMAILOCTOPUS_LIST_ID = "list-123";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("tags are an OBJECT MAP on PUT, not an array", () => {
  const tags = buildTags(["farmhousegetaways", "source-footer-home"]);
  assert.equal(Array.isArray(tags), false, "an array here silently applies no tags at all");
  assert.deepEqual(tags, { farmhousegetaways: true, "source-footer-home": true });
});

test("the three brand tags survive normalisation exactly as written", () => {
  // These three are the segmentation. If normalisation ever mangled one, every
  // send to that brand would quietly reach nobody.
  for (const t of ["farmhousegetaways", "minibarnmarket", "farmstandtv"]) {
    assert.deepEqual(buildTags([t]), { [t]: true }, `${t} must pass through untouched`);
  }
});

test("tag names are normalised so one audience cannot become two", () => {
  assert.deepEqual(buildTags(["Red Barn Ranch"]), { "red-barn-ranch": true });
  assert.deepEqual(buildTags(["  Mountain   Retreat  "]), { "mountain-retreat": true });
  assert.deepEqual(buildTags(["Farmstand.TV"]), { "farmstand-tv": true });
  assert.deepEqual(buildTags(["", null, undefined]), {}, "empties must not become a '-' tag");
});

test("upsert sends PUT to the list contacts endpoint with a bearer key", async () => {
  stubFetch();
  await upsertContact({ email: "a@example.com", firstName: "Dana", tags: ["mini-barn-market"] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].url, "https://api.emailoctopus.com/lists/list-123/contacts");
  assert.equal(calls[0].headers.authorization, "Bearer test-key");
  assert.deepEqual(calls[0].body, {
    email_address: "a@example.com",
    status: "subscribed",
    fields: { FirstName: "Dana" },
    tags: { "mini-barn-market": true },
  });
});

test("no first name means no fields object at all, rather than an empty one", async () => {
  stubFetch();
  await upsertContact({ email: "a@example.com", tags: [] });
  assert.equal("fields" in calls[0].body, false);
  assert.equal("tags" in calls[0].body, false);
});

test("a rejected tag costs the tag, never the signup", async () => {
  // First call 400s, the bare retry succeeds.
  let n = 0;
  globalThis.fetch = async (url, opts) => {
    calls.push({ body: JSON.parse(opts.body) });
    n++;
    return n === 1
      ? new Response(JSON.stringify({ title: "Bad tag" }), { status: 400 })
      : new Response(JSON.stringify({ id: "abc" }), { status: 200 });
  };

  const res = await upsertContact({ email: "a@example.com", firstName: "Dana", tags: ["x"] });
  assert.equal(res.ok, true, "the address must still land on the list");
  assert.ok(res.degraded, "and the downgrade must be reported, not hidden");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { email_address: "a@example.com", status: "subscribed" });
});

test("an empty address is refused without calling the API", async () => {
  stubFetch();
  const res = await upsertContact({ email: "   " });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test("the automation is started with an MD5 of the lowercased address", async () => {
  stubFetch({ status: 204, body: {} });
  await queueAutomation("Dana@Example.COM ", "auto-9");

  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.emailoctopus.com/automations/auto-9/queue");
  // md5("dana@example.com") — lowercased and trimmed first, or EmailOctopus
  // would look up a contact that does not exist and the welcome never sends.
  assert.deepEqual(calls[0].body, { contact_id: "e556d839bbda3d423c5b09096613f2d7" });
});

test("no automation configured means no call, and that is a success", async () => {
  stubFetch();
  const res = await queueAutomation("a@example.com", "");
  assert.equal(res.ok, true);
  assert.ok(res.skipped);
  assert.equal(calls.length, 0, "an unset automation id is a choice, not an error");
});

test("a contact already in the automation is not an error", async () => {
  stubFetch({ status: 409, body: { title: "Conflict" } });
  const res = await queueAutomation("a@example.com", "auto-9");
  assert.equal(res.ok, true, "a second signup must not resend the welcome, nor log a failure");
  assert.equal(res.alreadyQueued, true);
});

/* ------------------------------------------------------------------ *
 * The downgrade guard.
 *
 * Since every form's contact is stored, a non-consenting submission asks for
 * status "unsubscribed". PUT is an upsert, so writing that over somebody who
 * already subscribed would unsubscribe them — silently, permanently, and with
 * nothing about it looking broken until a send went out short.
 *
 * These are the tests that make that impossible.
 * ------------------------------------------------------------------ */

/**
 * A stub that can answer a GET as well as a PUT. The one above parses
 * opts.body unconditionally, which a GET does not have.
 */
function stubRoutes(existing) {
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === "GET") {
      if (!existing) return new Response(JSON.stringify({ title: "Not Found" }), { status: 404 });
      return new Response(JSON.stringify(existing), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "abc" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
}

const put = () => calls.filter((c) => c.method === "PUT").at(-1);

test("storing a NEW address as unsubscribed writes unsubscribed", async () => {
  stubRoutes(null);   // never seen before
  await upsertContact({ email: "new@example.com", tags: ["form-contact"], status: "unsubscribed" });
  assert.equal(put().body.status, "unsubscribed");
  assert.deepEqual(put().body.tags, { "form-contact": true }, "still tagged with its form");
});

test("storing an EXISTING SUBSCRIBER never unsubscribes them", async () => {
  stubRoutes({ email_address: "loyal@example.com", status: "subscribed" });
  await upsertContact({ email: "loyal@example.com", tags: ["form-contact"], status: "unsubscribed" });
  assert.equal(
    put().body.status, "subscribed",
    "⚠ they asked for the map in March; using the contact form in August must not unsubscribe them"
  );
});

test("a pending contact is left pending, not knocked down", async () => {
  stubRoutes({ email_address: "waiting@example.com", status: "pending" });
  await upsertContact({ email: "waiting@example.com", status: "unsubscribed" });
  assert.equal(put().body.status, "pending");
});

test("someone who genuinely unsubscribed stays unsubscribed", async () => {
  stubRoutes({ email_address: "gone@example.com", status: "unsubscribed" });
  await upsertContact({ email: "gone@example.com", status: "unsubscribed" });
  assert.equal(put().body.status, "unsubscribed");
});

test("EmailOctopus reports status in capitals, and that still counts", async () => {
  stubRoutes({ email_address: "loud@example.com", status: "SUBSCRIBED" });
  await upsertContact({ email: "loud@example.com", status: "unsubscribed" });
  assert.equal(put().body.status, "subscribed", "a capitalised status must not read as absent");
});

test("consent still raises a status — the guard only ever blocks lowering one", async () => {
  stubRoutes({ email_address: "asked@example.com", status: "unsubscribed" });
  await upsertContact({ email: "asked@example.com", status: "subscribed" });
  assert.equal(put().body.status, "subscribed", "they have now ticked the box");
  assert.equal(
    calls.filter((c) => c.method === "GET").length, 0,
    "a subscribe needs no lookup — nothing can be harmed by raising a status"
  );
});

test("a degraded retry does not smuggle the downgrade back in", async () => {
  // The rich PUT is rejected for its tags; the bare retry must still carry the
  // guarded status, not the raw one it was asked for.
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method, body });
    if (method === "GET") {
      return new Response(JSON.stringify({ status: "subscribed" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (body.tags) return new Response(JSON.stringify({ title: "Bad tag" }), { status: 422 });
    return new Response(JSON.stringify({ id: "abc" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const res = await upsertContact({
    email: "loyal@example.com", tags: ["form-contact"], status: "unsubscribed",
  });
  assert.ok(res.ok && res.degraded, "the bare retry succeeded");
  assert.equal(put().body.status, "subscribed", "⚠ the retry must not unsubscribe them either");
  assert.equal(put().body.tags, undefined, "the bare retry is bare");
});
