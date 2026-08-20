# Farmstand.TV

Static site — plain HTML, one CSS file, no build step, no npm.
Deployed by Netlify from `main`; `publish = "."`, no build command.

Live at https://farmstand.tv

## Where this code came from

The site was live on Netlify with no repository behind it, so the deployed
site was the only copy. This repository was seeded on 20 Aug 2026 from a
complete mirror of the live site.

That means **this is Netlify's post-processed output, not the original
source**: internal links are extensionless (`/about` rather than
`/about.html`) and attribute quotes are single rather than double. The site
works exactly as before, but if the original hand-written source turns up,
prefer it over this.

## Forms

Two Netlify forms: `farmstand` (stand owners adding themselves to the map)
and `contact`.

**Both were silently broken until 20 Aug 2026.** The `<form>` tags were
missing `data-netlify="true"`, so Netlify never intercepted the POST. Because
each form has `action="/thanks"`, the browser landed on the thank-you page and
the person submitting saw a normal confirmation — while the submission was
never recorded. Netlify still listed both forms in its dashboard, with every
field, because they had been marked correctly on an earlier deploy; the
attribute was dropped later and the form definitions stayed behind, receiving
nothing.

Any submission made before 20 Aug 2026 is gone. Netlify never received it.

Every form needs all three of these, or it fails the same silent way:

    <form name="..." method="POST" action="/thanks"
          data-netlify="true" netlify-honeypot="...">
      <input type="hidden" name="form-name" value="...">

`netlify-honeypot` must name the trap field on that form — `company` on the
farmstand form, `bot-field` on contact. Without it the trap field is recorded
as ordinary data instead of filtering bots.

After any change to a form, submit a real test and confirm it appears under
Netlify → Forms. A confirmation page proves nothing.

## Hidden from search on purpose

`robots.txt` says `Disallow: /` while farmstandtv.com still points elsewhere.
Change it to `Allow: /` the day the domain points here.
