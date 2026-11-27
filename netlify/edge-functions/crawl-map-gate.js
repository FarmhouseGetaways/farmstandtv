/* While showStands is false, the public tour URL sends people back to
   the crawl page. The private preview path is a different URL and is
   not handled here. */
export default async (req, context) => {
  const url = new URL(req.url);
  try {
    const res = await fetch(new URL("/data/crawl2026.json", url.origin), { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && data.showStands === true) return context.next();
    }
  } catch (e) { /* shut the public tour if the flag cannot be read */ }
  return Response.redirect(new URL("/crawl2026/", url.origin), 302);
};

export const config = {
  path: ["/crawl2026/map", "/crawl2026/map/"],
};
