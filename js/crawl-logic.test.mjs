import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const L = require("./crawl-logic.js");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("arrival radius stays inside 75–100 m", function () {
  assert.ok(L.ARRIVE_METERS >= 75 && L.ARRIVE_METERS <= 100);
});

test("matches a stand by name, id, or slug and reports typos", function () {
  var stands = [
    { id: 4, name: "Mini Barn Market", slug: "mini-barn", lat: 33.02, lng: -116.93 },
    { name: "Rad Living Ranch", lat: 33.03, lng: -116.96 },
    { name: "Olive & Oak Bakery", lat: 33.04, lng: -116.86 }
  ];
  var found = L.matchParticipants(stands, ["rad living ranch", "4", "olive-and-oak-bakery", "Not A Stand"]);
  assert.deepEqual(found.matched.map(function (s) { return s.name; }), [
    "Rad Living Ranch",
    "Mini Barn Market",
    "Olive & Oak Bakery"
  ]);
  assert.deepEqual(found.missing, ["Not A Stand"]);
  assert.equal(L.standKey(found.matched[1]), "id:4");
  assert.equal(L.standKey(found.matched[0]), "name:rad living ranch");
});

test("a positive Ramona longitude is treated as a missing minus sign", function () {
  var s = L.saneStand({ name: "Early Light", lat: 33.03, lng: 116.81 });
  assert.ok(s.lng < 0);
  var far = L.saneStand({ name: "Elsewhere", lat: 40, lng: -73 });
  assert.equal(far.outOfRange, true);
});

test("haversine and bearing agree with a north and an east step", function () {
  var d = L.haversine({ lat: 33, lng: -116 }, { lat: 34, lng: -116 });
  assert.ok(d > 110000 && d < 112000);
  assert.ok(L.bearing({ lat: 33, lng: -116 }, { lat: 34, lng: -116 }) < 1);
  var east = L.bearing({ lat: 33, lng: -116 }, { lat: 33, lng: -115 });
  assert.ok(Math.abs(east - 90) < 1);
});

test("suggested order starts at the nearest stand and does not mutate the list", function () {
  var origin = { lat: 33.0, lng: -116.9 };
  var far = { name: "Far", lat: 33.02, lng: -116.9 };
  var near = { name: "Near", lat: 33.005, lng: -116.9 };
  var input = [far, near];
  var opt = L.optimizeOrder(origin, input);
  assert.deepEqual(opt.map(function (s) { return s.name; }), ["Near", "Far"]);
  assert.deepEqual(input.map(function (s) { return s.name; }), ["Far", "Near"]);
  assert.deepEqual(L.optimizeOrder(null, input).map(function (s) { return s.name; }), ["Far", "Near"]);
});

test("a saved tour drops unknown stops and keeps new ones", function () {
  var stands = [
    { name: "Alpha", lat: 1, lng: 2 },
    { name: "Beta", lat: 3, lng: 4 },
    { name: "Gamma", lat: 5, lng: 6 }
  ];
  var saved = L.reconcile({
    order: ["name:beta", "name:gone", "name:alpha"],
    visited: ["name:beta"],
    started: true
  }, stands);
  assert.deepEqual(saved.order.map(function (s) { return s.name; }), ["Beta", "Alpha", "Gamma"]);
  assert.equal(saved.visited["name:beta"], true);
  assert.equal(saved.visited["name:alpha"], undefined);
  assert.equal(saved.started, true);
});

test("geofence stamps a close, sharp fix and refuses a vague one", function () {
  assert.equal(L.shouldArrive(90, 20), true);
  assert.equal(L.shouldArrive(90.1, 20), false);
  assert.equal(L.shouldArrive(40, 100), false);
  assert.equal(L.shouldArrive(40, null), true);
  assert.equal(L.shouldArrive(40, NaN), true);
});

test("distance and time read in plain units", function () {
  assert.equal(L.formatMiles(1609.344), "1.0 mi");
  assert.equal(L.formatMiles(10), "right here");
  assert.equal(L.formatEta(20), "under a minute");
  assert.equal(L.formatEta(120), "about 2 min");
  assert.ok(L.estimateSeconds(1609) > 60);
});

test("urls that are not http(s) are dropped", function () {
  assert.equal(L.safeUrl("javascript:alert(1)"), "");
  assert.equal(L.safeUrl("minibarnmarket.com"), "https://minibarnmarket.com");
  assert.equal(L.telHref("(760) 232-6999"), "tel:7602326999");
});

test("the crawl lineup matches stands we already have an address for", function () {
  var config = JSON.parse(readFileSync(join(root, "data/crawl2026.json"), "utf8"));
  var stands = JSON.parse(readFileSync(join(root, "data/stands.json"), "utf8")).stands;
  assert.equal(config.placeholder, false);
  assert.match(config.date, /December 19 and 20/);
  assert.match(config.time, /9 AM/);
  assert.match(config.prizes, /#RamonaFarmStandCrawl/);
  assert.equal(config.participants.length, 14);
  var extra = [
    { name: "The Coop", lat: 33.0106976, lng: -116.87, instagram: "https://www.instagram.com/Instathe_coop_farm_stand/" },
    { name: "Magnolia Ln Market", lat: 33.0516902, lng: -116.86 },
    { name: "Happy Homestead Farmstand", lat: 33.0520769, lng: -116.87 },
    { name: "The Corner Coop & Bakery", lat: 33.0247051, lng: -116.87, instagram: "https://www.instagram.com/thecornercoopandbakery/" },
    { name: "Sophia's Sweet & Savory Kitchen", lat: 33.039415, lng: -116.87 },
    { name: "Meyers Homestead", lat: 33.026124, lng: -116.9, instagram: "https://www.instagram.com/meyers_homestead/" }
  ];
  var found = L.matchParticipants(stands.concat(extra), config.participants);
  assert.deepEqual(found.missing, []);
  assert.equal(found.matched.length, 14);
  found.matched.forEach(function (s) { assert.equal(L.located(s), true); });
  assert.equal(found.matched[1].crawlName, "The Coop Farm Stand");
  assert.equal(found.matched[1].name, "The Coop");
  assert.equal(found.matched[2].name, "Magnolia Ln Market");
});
