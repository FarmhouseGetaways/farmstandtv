# Farmstand.TV — working on this site

A map of Ramona's farm stands, plus tours and a form for stands to add
themselves. Static HTML, no build step, no npm.

## The four properties, and who you are

You are the dedicated website builder for all four, the solo and lead developer
on every one. Assume every message is a change the owner wants made and
shipped: find it, change it, commit it, push it, and **confirm it is live by
fetching the live URL**, not by trusting the deploy.

| What | Repo | Live at |
|---|---|---|
| Farmhouse Getaways | `FarmhouseGetaways/farmhousegetaways` | farmhousegetaways.netlify.app (farmhousegetaways.com moving over) |
| Mini Barn Market | `FarmhouseGetaways/minibarnmarket` | minibarnmarket.com |
| Farmstand.TV | `FarmhouseGetaways/farmstandtv` | farmstand.tv and farmstandtv.com |
| The app | `FarmhouseGetaways/farmhouse-app` | farmhousegetawaysapp.netlify.app |

All on one Netlify team and one GitHub account. All deploy `main` on push with
`publish = "."`. **`farmhousegetaways/CLAUDE.md` is the long-form handover** —
brand voice, audience, history, every decision and why. Read it before writing
any copy for any of these brands.

**Never drag a folder onto Netlify.** A dragged deploy bypasses the repo, the
live site and `main` drift apart, and the next push silently reverts it. All
three websites were originally published that way, which is why their repos had
to be seeded from mirrors of the live sites in Aug 2026 — and why the map data,
the map pins and an entire Netlify function were lost in the process. Anything
fetched by JavaScript is invisible to a mirror.

**If a script produces a file, change the script.** Farmstand.TV generates
`data/*.json` from `tools/kml-to-data.py`. The app generates all its HTML,
`js/app.js`, `sw.js` and the manifest from `tools/build.py`. Hand edits to
generated files survive exactly until the next deploy.

## Form alerts

Every form on every site pushes to the owners' phones through the app:

    submitted -> Netlify stores it -> submission-created.mjs -> the app's
    push-alert -> sendToAdmins -> enrolled phones only

Never `sendToAll`: that reaches every guest who installed the app, and an
enquirer's name does not belong on a stranger's lock screen. Set
`ALERT_WEBHOOK_KEY` (the app's ADMIN_PASSWORD) on each site. Email
notifications are configured only in the Netlify UI — Forms → Settings and
usage — and live in no repository.

## This site specifically

- **The stand list itself is live, since 10 Sep 2026 — not generated.**
  `js/map.js` reads `https://farmhousegetawaysapp.netlify.app/.netlify/functions/stands`
  first — the same live, CORS-enabled endpoint the app's own Map tab and
  farmhousegetaways.com's farmstand map page read — falling back to the
  committed `data/stands.json` only if that's unreachable. A stand approved
  through farmhouse-admin now shows up here within the endpoint's 60-second
  cache window, same as everywhere else. **Before this**, this site only
  ever read the static file, so an approval never reached it at all — found
  live when Cory approved a stand and it appeared on the app and on
  farmhousegetaways.com but not here. Do not revert `LIVE` back to
  fallback-only; three separate farm-stand maps was the exact complaint
  that led here (see farmhouse-app's own CLAUDE.md for the fuller history
  of that fight).
- **`tools/kml-to-data.py` still owns `data/landmarks.json` and
  `data/roads.json`**, and remains `data/stands.json`'s fallback source —
  regenerated from Cory's Google My Map ("Ramona Farm Stands - V6"). Never
  hand-edit those files; the landmarks/roads layers are a deliberate,
  separate flourish this live change doesn't touch.
- **`"ours": true` marks our own stand.** `js/map.js` sorts it first and
  tags it "Ours" regardless of which source (live or fallback) supplied it —
  the live endpoint already carries this flag from farmhouse-app's own data.
- **`js/map.js` fetches everything it draws at runtime**, including the pin
  images. Nothing links to them, so no crawler or mirror will ever find them.
- **The farmstand form and the newsletter signup** need `data-netlify="true"`
  and `netlify-honeypot="bot-field"`. Not `company` — that name is autofilled
  by Chrome and Safari from a saved address, and this form asks for exactly
  the fields (owner name, address, city, state, zip) that trigger it. A real
  submission with autofill on would be silently discarded as spam. Renamed
  estate-wide; see the root `farmhousegetaways/CLAUDE.md` for the incident.
- `/images/logo-red.png` and `/images/logo-tan.png` are referenced somewhere
  and 404 — they belong to Mini Barn Market and pre-date the repo.
