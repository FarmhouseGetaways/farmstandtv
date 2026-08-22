/**
 * node --test netlify/functions/_lib/signup.test.mjs
 *
 * The consent rule is the reason this file exists. Everything else here is a
 * convenience; that one is a promise made on the page, and a regression in it
 * would look exactly like working software.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { contactFrom, brand } from "./signup.mjs";

test("a newsletter signup is subscribed and tagged with brand and source", () => {
  const c = contactFrom("newsletter", {
    email: "someone@example.com",
    "first-name": "Dana",
    source: "footer-home",
  });
  assert.equal(c.email, "someone@example.com");
  assert.equal(c.firstName, "Dana");
  assert.equal(c.status, "subscribed");
  assert.ok(c.tags.includes(brand()));
  assert.ok(c.tags.includes("source-footer-home"));
});

test("an inquiry with the box UNTICKED produces no contact", () => {
  assert.equal(contactFrom("group-inquiry", { email: "bride@example.com", name: "Sam" }), null);
  assert.equal(
    contactFrom("group-inquiry", { email: "bride@example.com", "email-opt-in": "" }),
    null
  );
});

test("an inquiry with the box ticked produces a tagged lead", () => {
  const c = contactFrom("group-inquiry", {
    email: "bride@example.com",
    name: "Sam Rivera",
    "email-opt-in": "yes",
    source: "book-both",
  });
  assert.equal(c.email, "bride@example.com");
  assert.equal(c.firstName, "Sam", "first name only — the list greets people, it does not file them");
  assert.ok(c.tags.includes("group-inquiry"));
  assert.ok(c.tags.includes("lead"));
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

test("forms we do not sync, and submissions with no address, are ignored", () => {
  assert.equal(contactFrom("some-other-form", { email: "x@example.com" }), null);
  assert.equal(contactFrom("newsletter", {}), null);
  assert.equal(contactFrom("newsletter", { email: "   " }), null);
});
