/**
 * Netlify calls this by itself, once, for every form submission it has
 * verified as not spam. Nothing on the site points at it and nothing needs to.
 *
 * Its whole job is to tell somebody a form came in.
 *
 * WHAT ALREADY HAPPENS WITHOUT IT
 * The submission is stored by Netlify the moment it arrives — Forms → contact
 * in the dashboard — and email notifications to a named address are configured
 * there too, in the UI, not in code. Neither of those depends on this file.
 * This is the extra channel: a push to a phone, which the dashboard cannot do.
 *
 * WHAT A FAILURE HERE COSTS
 * Nothing a visitor can see. They are already looking at the thanks page and
 * the submission is already saved. A failure means one missed buzz and a line
 * in the function log, which is the right way round — so every path below
 * swallows its errors and this always answers 200. Throwing would make Netlify
 * retry, and a retry means the same submission announced twice.
 *
 * WHERE THE ALERT GOES
 * Whichever of these is configured. Both, neither, or one — all fine.
 *
 *   NTFY_TOPIC     a topic on ntfy.sh. Install the ntfy app, subscribe to the
 *                  same topic, and submissions arrive on the phone. No account
 *                  and no key, so the topic name IS the secret: make it long
 *                  and unguessable, because anyone who knows it can both read
 *                  your alerts and send you them.
 *
 *   ALERT_WEBHOOK  a URL to POST the same alert to as JSON, for the Farmhouse
 *                  app's own push once it grows an admin channel. Sent with
 *                  ALERT_WEBHOOK_KEY in an x-admin-key header when that is set.
 *
 * SITE_LABEL names the site in the alert, so three sites pushing to one phone
 * are still tellable apart.
 */

const SITE = process.env.SITE_LABEL || "Farmstand.TV";

/** The fields worth putting in a notification, in the order a person reads. */
const INTERESTING = [
  "stand-name", "first-name", "last-name", "name",
  "email", "phone", "city", "message",
];

function summarise(formName, data) {
  const pretty = { contact: "enquiry", farmstand: "farmstand submission" }[formName] || formName;

  const who = [data["first-name"], data["last-name"]].filter(Boolean).join(" ").trim()
    || data["stand-name"] || data.name || data.email || "someone";

  const lines = [];
  for (const key of INTERESTING) {
    const value = (data[key] || "").toString().trim();
    if (value) lines.push(`${key}: ${value}`);
  }
  // Anything the form collects that is not in the list above still matters —
  // a form gains a field far more often than this file gets updated.
  for (const [key, value] of Object.entries(data)) {
    if (INTERESTING.includes(key)) continue;
    if (key === "bot-field" || key === "company" || key === "form-name") continue;
    const v = (value || "").toString().trim();
    if (v) lines.push(`${key}: ${v}`);
  }

  return {
    title: `${SITE}: ${pretty} from ${who}`,
    body: lines.join("\n").slice(0, 1200) || "No details were filled in.",
  };
}

async function toNtfy(alert) {
  const topic = (process.env.NTFY_TOPIC || "").trim();
  if (!topic) return "skipped";
  const url = topic.startsWith("http") ? topic : `https://ntfy.sh/${topic}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      // Header values must be latin-1, and these strings are people's names.
      // Anything outside that range is dropped rather than throwing.
      title: alert.title.replace(/[^\x20-\x7E]/g, ""),
      tags: "seedling",
      priority: "default",
    },
    body: alert.body,
  });
  return res.ok ? "sent" : `failed ${res.status}`;
}

async function toWebhook(alert, formName, data) {
  // The app's owner-alert endpoint. Not a secret — it rejects anything
  // without the key — so it is defaulted here rather than being a third
  // variable to set on three sites. ALERT_WEBHOOK overrides it if the app
  // ever moves.
  const url = (process.env.ALERT_WEBHOOK || "https://farmhousegetawaysapp.netlify.app/.netlify/functions/push-alert").trim();
  if (!url) return "skipped";
  const key = (process.env.ALERT_WEBHOOK_KEY || "").trim();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-admin-key": key } : {}),
    },
    body: JSON.stringify({ ...alert, site: SITE, form: formName, data }),
  });
  return res.ok ? "sent" : `failed ${res.status}`;
}

export default async (req) => {
  const json = (obj) =>
    new Response(JSON.stringify(obj), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  let payload;
  try {
    const body = await req.json();
    // Netlify wraps the submission in `payload`. Accept a bare object too, so
    // this can be exercised by hand with curl.
    payload = body?.payload ?? body;
  } catch {
    return json({ ok: false, reason: "unreadable body" });
  }

  const formName = payload?.form_name || payload?.formName || "";
  const data = payload?.data || {};
  if (!formName) return json({ ok: false, reason: "no form name" });

  const alert = summarise(formName, data);

  const [ntfy, webhook] = await Promise.all([
    toNtfy(alert).catch((e) => `error ${e.message}`),
    toWebhook(alert, formName, data).catch((e) => `error ${e.message}`),
  ]);

  return json({ ok: true, form: formName, ntfy, webhook });
};
