export default async function handler(req, res) {
  const API_URL = process.env.FUMOROOM_API_URL; 
 
  if (!API_URL) {
    res.status(500).json({ ok: false, error: "api_url_not_configured" });
    return;
  }
 
  try {
    const upstream = await fetch(API_URL);
    const data = await upstream.json();
    // Небольшое кэширование, чтобы не дёргать Apps Script на каждый чих
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: "upstream_failed" });
  }
}
