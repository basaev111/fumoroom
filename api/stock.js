// Vercel serverless: наличие из PodControl в формате, который ждёт index.html.
// Переменные окружения: PODCONTROL_STOCK_URL (секретная ссылка PodControl),
// FUMOROOM_API_URL (старый источник, запасной и для фото/категорий).

const LOW_THRESHOLD = 5;

function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
function slug(s) { return norm(s).replace(/[^a-z0-9а-яёіїєґ]+/gi, "-").replace(/^-|-$/g, ""); }

// Категория PodControl (название) -> cat сайта, по ключевым словам.
function catFromName(name) {
  const n = norm(name);
  if (!n) return null;
  if (/одноразк|disposable/.test(n)) return "disposables";
  if (/жидк|liquid/.test(n)) return "liquids";
  if (/картридж|cartridge/.test(n)) return "cartridges";
  if (/под|pod/.test(n)) return "pods";
  return null;
}

// Запасные настройки: берутся, когда старый источник недоступен или поле пустое.
// Telegram-ссылку задайте переменной TELEGRAM_LINK в Vercel (иначе общая https://t.me/).
const DEFAULT_SETTINGS = {
  telegramLink: process.env.TELEGRAM_LINK || "https://t.me/",
  courierFee: 15,
  courierFreeFrom: 150,
  infoDeliveryValue: {
    ru: "Самовывоз или курьер. Детали уточняйте в Telegram.",
    ua: "Самовивіз або кур'єр. Деталі уточнюйте в Telegram."
  },
  infoPaymentValue: {
    ru: "Наличными или переводом при получении.",
    ua: "Готівкою або переказом при отриманні."
  }
};

function mergeSettings(s) {
  const out = Object.assign({}, DEFAULT_SETTINGS);
  for (const k in (s || {})) {
    const v = s[k];
    if (v == null || v === "") continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const d = DEFAULT_SETTINGS[k] || {};
      out[k] = { ru: v.ru || d.ru || "", ua: v.ua || d.ua || "" };
    } else out[k] = v;
  }
  return out;
}

function statusOf(it) {
  if (it.level === "in" || it.level === "low" || it.level === "out") return it.level;
  const q = Number(it.qty);
  if (!isFinite(q) || q <= 0) return "out";
  return q <= LOW_THRESHOLD ? "low" : "in";
}

// Преобразование ответа PodControl в формат {products, settings}.
// old — { products, settings } из старого источника (может быть пустым).
function transform(pc, old) {
  const oldProducts = (old && old.products) || [];
  const byKey = new Map();
  const byBrand = new Map();
  for (const p of oldProducts) {
    byKey.set(norm(p.brand) + "|" + norm(p.name), p);
    if (!byBrand.has(norm(p.brand))) byBrand.set(norm(p.brand), p);
  }
  const products = [];
  for (const it of (pc && pc.items) || []) {
    const brand = String(it.brand || "").trim();
    const name = String(it.flavor || "").trim();
    if (!brand || !name) continue;
    const mg = it.variant != null && isFinite(Number(it.variant)) ? Number(it.variant) : null;
    const o = byKey.get(norm(brand) + "|" + norm(name));
    const ob = byBrand.get(norm(brand));
    let price = Number(it.price);
    if (!isFinite(price) || it.price == null) price = o ? Number(o.price) : (ob ? Number(ob.price) : 0);
    if (!isFinite(price) || price <= 0) price = null;
    let effective = price;
    if (price != null && o && it.price == null && o.effectivePrice != null) effective = Number(o.effectivePrice);
    const p = {
      id: (o && o.id) || ("pc-" + slug(brand) + "-" + (mg == null ? "x" : mg) + "-" + slug(name)),
      brand,
      cat: catFromName(it.category) || (o && o.cat) || (ob && ob.cat) || "disposables",
      name,
      price,
      effectivePrice: effective,
      mg: mg != null ? mg : ((o && o.mg) || (ob && ob.mg) || null),
      ml: (o && o.ml) || (ob && ob.ml) || null,
      bestseller: !!(o && o.bestseller),
      status: statusOf(it)
    };
    const img = (o && o.image) || (ob && ob.image);
    if (img) p.image = img;
    if (o && Array.isArray(o.colors)) p.colors = o.colors;
    products.push(p);
  }
  return { products, settings: mergeSettings(old && old.settings) };
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("http_" + r.status);
  return r.json();
}

async function loadOld() {
  const url = process.env.FUMOROOM_API_URL;
  if (!url) return null;
  try {
    const j = await fetchJson(url);
    return j && j.ok && j.data ? j : null;
  } catch (e) { return null; }
}

async function handler(req, res) {
  const cache = () => res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  const pcUrl = process.env.PODCONTROL_STOCK_URL;
  const old = await loadOld();
  if (pcUrl) {
    try {
      const pc = await fetchJson(pcUrl);
      if (pc && Array.isArray(pc.items)) {
        cache();
        res.status(200).json({ ok: true, data: transform(pc, old && old.data) });
        return;
      }
    } catch (e) { /* падаем на старый источник */ }
  }
  if (old) { cache(); res.status(200).json(old); return; }
  res.status(502).json({ ok: false, error: "upstream_failed" });
}

module.exports = handler;
module.exports.transform = transform;
module.exports.catFromName = catFromName;
