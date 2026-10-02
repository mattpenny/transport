#!/usr/bin/env node
/* 產生「跨裝置共用」的交通消息存檔：traffic-news-archive.json
 *
 * 用途：index.html 的「特別交通消息」面板除了即時 XML 與瀏覽器本機存檔之外，
 *       還會下載這個靜態檔並合併。因為它是放在網站上的同一個檔案，所有裝置
 *       （電腦、手機）都會看到同一份記錄，解決各瀏覽器 localStorage
 *       不會同步的問題。
 *
 * 用法：
 *   node tools/build-traffic-news.js
 *
 * 排程：見 .github/workflows/update-traffic-news.yml（每 30 分鐘跑一次並在
 *       檔案有變時自動 commit）。
 *
 * 設計：每次執行都會把「即時 XML 抓到的」與「檔案內原有的」合併、以 id 去重，
 *       排序後只保留最新 MAX_ITEMS 則 —— 即固定的滾動窗口，最舊的會被擠出。
 *       ⚠️ 上限已由「保留 3 日」（RETAIN_DAYS）改為「固定 15 則」，與
 *       index.html 的 NEWS_MAX_ITEMS 一致。改回按日數會令共用檔重新塞進
 *       大量舊消息，前端那份 15 則的上限就形同被上游繞過。
 *       whenText 原樣保存；whenMs 只是排序用的近似值，前端會用自己的 parseDate
 *       以 whenText 重算，確保時間基準一致。
 */
const fs = require("fs");
const path = require("path");

const NEWS_URL = "https://www.td.gov.hk/tc/special_news/trafficnews.xml";
const OUT = path.join(__dirname, "..", "traffic-news-archive.json");
const MAX_ITEMS = 15;       /* 與 index.html 的 NEWS_MAX_ITEMS 一致 */

function decodeXml(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/* XML 結構極簡（<message> 內全是同名單層標籤），所以用 regex 取值即可，
   毋須引入額外套件。 */
function tag(body, name) {
  const m = new RegExp("<" + name + ">([\\s\\S]*?)<\\/" + name + ">").exec(body);
  return m ? decodeXml(m[1]).trim() : "";
}

/* TD 的 ANNOUNCEMENT_DATE 無時區（香港時間）。加 +08:00 再 parse，
   得到正確的 UTC 瞬間；前端會用自己的 parseDate 重算，這裡只是排序用。 */
function whenToMs(whenText) {
  if (!whenText) return 0;
  const s = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(whenText) ? whenText + "+08:00" : whenText;
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

function parseNews(xml) {
  const out = [];
  const re = /<message>([\s\S]*?)<\/message>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const whenText = tag(b, "ANNOUNCEMENT_DATE");
    const statusEn = tag(b, "INCIDENT_STATUS_EN").toUpperCase();
    const statusCn = tag(b, "INCIDENT_STATUS_CN");
    out.push({
      id: tag(b, "ID") || tag(b, "INCIDENT_NUMBER"),
      heading: tag(b, "INCIDENT_HEADING_CN") || "交通消息",
      detail: tag(b, "CONTENT_CN") || tag(b, "INCIDENT_DETAIL_CN"),
      location: tag(b, "LOCATION_CN"),
      direction: tag(b, "DIRECTION_CN"),
      landmark: tag(b, "NEAR_LANDMARK_CN"),
      status: statusCn,
      closed: /CLOSED|CANCELLED|完結|取消/.test(statusEn + statusCn),
      whenText,
      whenMs: whenToMs(whenText),
    });
  }
  return out;
}

function readPrev() {
  try {
    const j = JSON.parse(fs.readFileSync(OUT, "utf8"));
    return Array.isArray(j) ? j : (j && Array.isArray(j.messages) ? j.messages : []);
  } catch (e) { return []; }
}

async function main() {
  const now = Date.now();
  let incoming = [];
  try {
    const res = await fetch(NEWS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    incoming = parseNews(await res.text());
  } catch (e) {
    console.error("⚠ 抓取即時 XML 失敗，沿用原有存檔：", e.message);
  }

  /* 新抓到的優先（同一 id 的話用新的），舊檔的其餘補上。 */
  const seen = Object.create(null);
  const merged = [];
  for (const n of incoming.concat(readPrev())) {
    const key = String(n.id || n.heading || n.whenText || "");
    if (!key || seen[key]) continue;
    seen[key] = true;
    merged.push(Object.assign({}, n, { whenMs: n.whenMs || 0, storedAt: n.storedAt || now }));
  }

  /* ⚠️ 先排序、後裁切。若在合併迴圈裡就用長度 break，砍掉的是「還沒排序」
     的那批，等於隨機丟資料 —— 與前端 mergeNewsStore 的原則一致。 */
  const kept = merged
    .sort((a, b) => (b.whenMs || 0) - (a.whenMs || 0))
    .slice(0, MAX_ITEMS);

  const doc = {
    source: NEWS_URL,
    sourceName: "特別交通消息（運輸署開放數據）",
    note: "跨裝置共用的交通消息存檔，由 tools/build-traffic-news.js 產生；index.html 會下載並與即時資料及本機存檔合併。",
    generated: new Date().toISOString(),
    maxItems: MAX_ITEMS,
    count: kept.length,
    messages: kept,
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log("✔ 已寫入 " + OUT + "（" + kept.length + " 則）");
}

main().catch((e) => { console.error("✘ 產生失敗：", e && e.message ? e.message : e); process.exit(1); });
