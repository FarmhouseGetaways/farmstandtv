/**
 * node --test netlify/functions/_lib/signup.test.mjs
 *
 * The consent rule is the reason this file exists. Everything else here is a
 * convenience; that one is a promise made on the page, and a regression in it
 * would look exactly like working software.
 *
 * Since 22 Aug 2026 the rule is no longer "is this contact stored" but "may
 * this contact be mailed". Storing everybody is the point; mailing only the
 * ones who agreed is the promise. These tests hold that line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { contactFrom, brand } from "./signup.mjs";

test("a newsletter signup is subscribed and tagged with brand, form and source", () => {
  const c = contactFrom("newsletter", {
    email: "someone@example.com",
    "first-name": "Dana",
    source: "footer-home",
  });
  assert.equal(c.email, "someone@example.com");
  assert.equal(c.firstName, "Dana");
  assert.equal(c.status, "subscribed");
  assert.equal(c.consent, true);
  assert.ok(c.tags.includes(brand()));
  assert.ok(c.tags.includes("form-newsletter"));
  assert.ok(c.tags.includes("source-footer-home"));
  assert.equal(c.tags.includes("lead"), false, "a signup is not a lead, it is a subscriber");
});

test("an inquiry with the box UNTICKED is stored but never mailed", () => {
  for (const data of [
    { email: "bride@example.com", name: "Sam" },
    { email: "bride@example.com", "email-opt-in": "" },
    { email: "bride@example.com", "email-opt-in": "no" },
  ]) {
    const c = contactFrom("group-inquiry", data);
    assert.ok(c, "the contact is stored — this is what the owner asked for");
    assert.equal(c.status, "unsubscribed", "⚠ CONSENT: EmailOctopus must never mail this person");
    assert.equal(c.consent, false, "⚠ CONSENT: the welcome automation must not run");
    assert.ok(c.tags.includes("form-group-inquiry"), "still filterable by the form it came from");
  }
});

test("an inquiry with the box ticked produces a tagged, mailable lead", () => {
  const c = contactFrom("group-inquiry", {
    email: "bride@example.com",
    name: "Sam Rivera",
    "email-opt-in": "yes",
    source: "book-both",
  });
  assert.equal(c.email, "bride@example.com");
  assert.equal(c.firstName, "Sam", "first name only — the list greets people, it does not file them");
  assert.equal(c.status, "subscribed");
  assert.equal(c.consent, true);
  assert.ok(c.tags.includes("form-group-inquiry"));
  assert.ok(c.tags.includes("lead"));
});

test("every tick spelling a browser might send counts as yes", () => {
  for (const yes of ["yes", "on", "true", "YES", " On "]) {
    assert.equal(
      contactFrom("group-inquiry", { email: "a@example.com", "email-opt-in": yes }).status,
      "subscribed",
      `"${yes}" is a ticked box`
    );
  }
});

test("the other two sites' forms are stored, tagged and not mailable", () => {
  const contact = contactFrom("contact", {
    email: "jo@example.com", name: "Jo Nakamura", phone: "760-555-0198",
  });
  assert.equal(contact.status, "unsubscribed");
  assert.ok(contact.tags.includes("form-contact"));
  assert.equal(contact.tags.includes("lead"), false, "a shop enquiry is not a booking lead");
  assert.equal(contact.firstName, "Jo");

  const stand = contactFrom("farmstand", {
    email: "dale@example.com", "owner-first": "Dale", "owner-last": "Marsh",
    "stand-name": "Handlebar Produce",
  });
  assert.equal(stand.status, "unsubscribed");
  assert.ok(stand.tags.includes("form-farmstand"));
  assert.equal(stand.tags.includes("lead"), false, "a stand listing itself is not a booking lead");
  assert.equal(stand.firstName, "Dale", "the owner's name, not the stand's");
});

test("a form nobody has heard of is still stored and still tagged", () => {
  const c = contactFrom("some-new-form", { email: "x@example.com" });
  assert.ok(c, "a form gains a name far more often than this file is edited");
  assert.ok(c.tags.includes("form-some-new-form"));
  assert.equal(c.status, "unsubscribed", "unknown means unconsented, never the other way round");
});

test("a property choice becomes a tag, but a vague one does not", () => {
  const rbr = contactFrom("newsletter", { email: "a@example.com", property: "Red Barn Ranch" });
  assert.ok(rbr.tags.includes("Red Barn Ranch"));

  const long = contactFrom("group-inquiry", {
    email: "b@example.com",
    "email-opt-in": "yes",
    property: "Mountain Retreat — sleeps 14",
  });
  assert.ok(long.tags.includes("Mountain Retreat"), "the sleeps-N suffix is not a separate audience");

  for (const vague of ["Both or not sure yet", "Not sure yet — help us decide", "Both — sleeps 34"]) {
    const c = contactFrom("newsletter", { email: "c@example.com", property: vague });
    assert.equal(
      c.tags.some((t) => /both|not-sure|sure/i.test(t)),
      false,
      `"${vague}" should add no property tag`
    );
  }
});

test("a submission with no address is the only thing ignored", () => {
  assert.equal(contactFrom("newsletter", {}), null);
  assert.equal(contactFrom("newsletter", { email: "   " }), null);
  assert.equal(contactFrom("farmstand", { "stand-name": "No Email Farm" }), null);
});
