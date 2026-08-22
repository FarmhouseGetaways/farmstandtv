/**
 * GET /.netlify/functions/alerts-status
 *
 * Answers one question: is this site wired up to send form alerts?
 *
 * Booleans only. It never returns a key, a URL with a secret in it, or
 * anything about a submission — so it needs no password of its own, which
 * matters because the thing you are usually diagnosing IS the password.
 * Guarding it with the key you are trying to check would be a locked door
 * with the key inside.
 *
 * Written on 20 Aug 2026 after two form submissions produced no notification
 * and the only way to find out why was reading Netlify's function logs. That
 * is a poor answer to give somebody twice.
 */
export default async () => {
  const set = (name) => Boolean((process.env[name] || "").trim());
  return Response.json(
    {
      site: process.env.SITE_LABEL || "(SITE_LABEL not set)",
      alerts: {
        // The app endpoint has a default baked in, so this is almost always true.
        webhookUrl: set("ALERT_WEBHOOK") || true,
        // This is the one that is usually missing. Without it the site posts
        // to the app with no credential and the app answers 401.
        webhookKey: set("ALERT_WEBHOOK_KEY"),
        ntfyTopic: set("NTFY_TOPIC"),
      },
      // Contacts from every form on this site are stored on the shared
      // EmailOctopus list, tagged with the form they came through. Without
      // both of these the submission still reaches the Netlify inbox and still
      // pushes an alert — it simply is not filed anywhere.
      contacts: {
        apiKey: set("EMAILOCTOPUS_API_KEY"),
        listId: set("EMAILOCTOPUS_LIST_ID"),
        // Optional. Unset, EmailOctopus's own "joined the list" trigger owns
        // the welcome email; set, this site names its own automation.
        automationId: set("EMAILOCTOPUS_AUTOMATION_ID"),
        // Optional. Falls back to SITE_LABEL, which is already set here.
        brand: (process.env.EMAILOCTOPUS_BRAND || process.env.SITE_LABEL || "").trim() || null,
        storing: set("EMAILOCTOPUS_API_KEY") && set("EMAILOCTOPUS_LIST_ID"),
      },
      ready: set("ALERT_WEBHOOK_KEY") || set("NTFY_TOPIC"),
    },
    { headers: { "cache-control": "no-store" } }
  );
};
