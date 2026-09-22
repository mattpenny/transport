# Ansum Transport

香港交通實時到站查詢應用 — 支援巴士、專線小巴，未來將加入渡輪及港鐵。

## 線上版

- **巴士**：[https://mattpenny.github.io/bus/](https://mattpenny.github.io/bus/)
- **小巴**：[https://mattpenny.github.io/bus/gmb.html](https://mattpenny.github.io/bus/gmb.html)

---

## 目錄

1. [功能總覽](#功能總覽)
2. [檔案結構](#檔案結構)
3. [部署步驟](#部署步驟)
4. [技術架構](#技術架構)
5. [資料來源](#資料來源)
6. [關鍵實作細節](#關鍵實作細節)
7. [除錯與測試](#除錯與測試)
8. [常見問題](#常見問題)
9. [未來擴充](#未來擴充)

---

## 功能總覽

| 功能 | 巴士 (`index.html`) | 小巴 (`gmb.html`) | 渡輪 (`ferry.html`) |
|---|:---:|:---:|:---:|
| 路線搜尋 | ✅ | ✅（按區域） | 🚧 |
| 方向選擇 | ✅ | ✅ | 🚧 |
| 站點列表 | ✅ | ✅ | 🚧 |
| 實時到站 (ETA) | ✅ 最近 3 班 | ✅ 最近 3 班 | 🚧 |
| 全程票價 | ✅ | ✅ | 🚧 |
| 分段收費 | ✅ | ❌ | ❌ |
| 地圖顯示 | ✅ | ✅ | 🚧 |
| GPS 自動定位最近站 | ✅ | ✅ | 🚧 |
| 我的最愛 | ✅ 6 個 | ✅ 6 個 | 🚧 |
| 字型大小調整 | ✅ | ✅ | 🚧 |
| API 節流保護 | — | ✅（防 429） | — |

---

## 檔案結構

在 GitHub Pages 的根目錄應包含：

```
你的 repo/
├── index.html                  ← 巴士模式主頁
├── gmb.html                    ← 專線小巴模式
├── ferry.html                  ← 渡輪模式（未實作）
├── bus.png                     ← 應用圖示
├── gmb-stops-coords.csv        ← 全港 GMB 站點座標（政府靜態資料）
├── routeFareList.min.json      ← 票價資料（從 hkbus.app 手動下載）
└── README.md                   ← 本文件
```

### 各檔案用途

| 檔案 | 用途 | 更新頻率 |
|---|---|---|
| `index.html` | 巴士介面（單一檔案，含 HTML + CSS + JS） | 只在改功能時 |
| `gmb.html` | 小巴介面（單一檔案） | 只在改功能時 |
| `bus.png` | 應用圖示（favicon 與 header logo） | 極少 |
| `gmb-stops-coords.csv` | GMB 站點 HK80 座標 | 每 3-6 個月 |
| `routeFareList.min.json` | 全港巴士與小巴票價 | 每 3-6 個月 |

### 為什麼用單一 HTML 檔案？

- 每個交通模式完全獨立，互不影響
- 修改一個模式不會影響其他模式
- 部署簡單：只需上傳檔案
- WebView APK 直接可用，不需建置工具

---

## 部署步驟

### 1. 準備 GitHub Pages

1. 建立 GitHub repo（例如 `bus`）
2. 進入 repo 的 **Settings → Pages**
3. Source 選擇 **Deploy from a branch**
4. Branch 選 **main**（或 `master`），資料夾選 **/ (root)**
5. 儲存，等待 1-2 分鐘讓 GitHub 建立網站

### 2. 上傳必要檔案

使用 GitHub 網頁介面或 `git push`，把以下檔案放入 repo 根目錄：

- `index.html`
- `gmb.html`
- `bus.png`
- `gmb-stops-coords.csv`
- `routeFareList.min.json`

### 3. 驗證

在瀏覽器開啟：

```
https://<你的帳號>.github.io/<repo>/
```

應看到巴士介面。點「專線小巴」應跳到 `gmb.html`。

---

## 技術架構

### 前端框架

| 項目 | 版本 | 用途 |
|---|---|---|
| Vue 3 | 3.x (global build) | 響應式 UI |
| Leaflet | 1.9.4 | 互動地圖 |
| 原生 CSS | — | 全部樣式內嵌 |
| 無建置工具 | — | 直接部署 |

### 通訊協定

- 全部使用 `fetch` + HTTPS
- 所有 API 請求加上 `cache: "no-store"`，避免瀏覽器快取舊 ETA

### 儲存機制

| 用途 | 儲存方式 | Key 前綴 |
|---|---|---|
| 我的最愛（巴士） | localStorage + cookie | `hk-bus-eta-favourites` |
| 我的最愛（小巴） | localStorage + cookie | `hk-gmb-favourites-v1` |
| 字型大小 | localStorage + cookie | `hk-bus-font-scale` |
| 票價快取（巴士） | localStorage | `hk-bus-fare-data-v4` |
| 票價快取（小巴） | localStorage | `hk-gmb-fare-data-v3` |
| GMB 站點座標快取 | localStorage | `hk-gmb-stop-coords-v1` |

### 快取策略

| 資料 | 快取時間 | 儲存位置 |
|---|---|---|
| 路線清單 | 記憶體內（session） | `routeListsCache` |
| 小巴站點列表 | 記憶體內 | `stopsCache` |
| 小巴 ETA | 30 秒 | `etaCache` |
| 票價資料 | 7 天 | localStorage |
| GMB 站點座標 | 30 天 | localStorage |

### API 節流

小巴 API (`data.etagmb.gov.hk`) 有嚴格請求限制，實作以下保護：

```javascript
const GMB_MIN_INTERVAL_MS = 800;  // 兩次請求間最少間隔
```

任何對 GMB API 的請求都會經過 `gmbFetch()` 排隊，避免觸發 HTTP 429。

---

## 資料來源

### 實時到站 (ETA)

| 交通 | API 端點 |
|---|---|
| 九巴 (KMB) | `https://data.etabus.gov.hk/v1/transport/kmb` |
| 城巴 (CTB) | `https://rt.data.gov.hk/v2/transport/citybus` |
| 新大嶼山巴士 (NLB) | `https://rt.data.gov.hk/v2/transport/nlb` |
| 專線小巴 (GMB) | `https://data.etagmb.gov.hk` |

### 靜態資料

| 資料 | 來源 | 格式 |
|---|---|---|
| 票價 | [hkbus.app](https://data.hkbus.app/routeFareList.min.json) | JSON |
| GMB 站點座標 | [data.gov.hk](https://data.gov.hk) | CSV（HK80 座標） |
| 地圖底圖 | 地政總署 CSDI | PNG 瓦片 |
| 地圖標籤 | 地政總署 CSDI | PNG 瓦片 |

### 更新週期

| 資料 | 原始更新頻率 | 建議手動更新頻率 |
|---|---|---|
| ETA | 每分鐘 | — |
| 票價 | 每日（hkbus.app） | 每 3-6 個月 |
| GMB 站點座標 | 每兩週（政府） | 每 6 個月 |
| 路線清單 | 不定期 | — |

---

## 關鍵實作細節

### 1. 票價資料為何放在本地？

原本票價資料從 `data.hkbus.app` 或 `hkbus.github.io` 載入，但香港部分網路環境（ISP DNS、公司防火牆）會封鎖這兩個 CDN，導致 `fetch` 永遠 pending。因此：

1. 手動從 hkbus.app 下載 `routeFareList.min.json`
2. 上傳到自己的 GitHub Pages
3. 前端從**同一個域名**載入，無跨域問題

修改後的 `FARE_URL_PRIMARY`：

```javascript
const FARE_URL_PRIMARY = "routeFareList.min.json";   // 相對路徑
const FARE_URL_FALLBACK = "routeFareList.min.json";  // 相同（純備援）
```

### 2. HK80 Grid → WGS84 轉換

政府 GMB 站點座標使用 **HK80 Grid**（香港 1980 大地坐標系），而 Leaflet 需要 **WGS84** 經緯度。程式內嵌完整轉換公式（約 60 行），不需外部函式庫。

```javascript
function hk80ToWgs84(easting, northing) {
  // 1. HK80 Grid → HK80 geodetic
  // 2. HK80 → WGS84 加 datum 偏移
  return { lat, lng };
}
```

驗證：座標精度在 ±1-2 公尺內，對地圖顯示完全足夠。

### 3. GMB 票價索引

`routeFareList.min.json` 的結構中，每筆條目包含：

```json
"1+1+Central+The Peak": {
  "bound": { "gmb": "I" },
  "co": ["gmb"],
  "fares": ["11.8", "11.8", ...],
  "route": "1",
  "serviceType": 1
}
```

**關鍵**：不要用外部 key（那是 hkbus 內部格式），而是**從條目內部讀取 `route`、`serviceType`、`bound.gmb` 三個欄位**，組合成 `routeCode+serviceType+bound` 作為索引 key。

```javascript
const indexKey = `${routeCode}+${serviceType}+${boundGmb}`;
```

### 4. 分段收費邏輯（僅巴士）

巴士票價支援分段收費。查價流程：

1. 取得該路線的 `fares` 陣列（按站點順序）
2. 用所選站點的 `id` 在 `stops[公司]` 陣列中找索引
3. 若找不到，退回用 `seq`（站點序號）
4. 若仍找不到，顯示全程票價 `fares[0]`
5. 若 `fares[idx] !== fares[0]`，標記為分段收費

顯示格式：

- 分段：`收費 $8.1 (全程收費: $12.5)`
- 全程：`全程收費 $12.5`

### 5. 最愛壓縮

當使用者刪除中間的最愛時，後面的會往前補：

```javascript
function compactFavourites(arr) {
  const nonNull = arr.filter(Boolean);
  const result = new Array(MAX_FAVOURITES).fill(null);
  for (let i = 0; i < nonNull.length; i++) result[i] = nonNull[i];
  return result;
}
```

### 6. 節流：避免 GMB API 429

小巴 API 對請求頻率敏感。所有 GMB 請求都經過：

```javascript
async function gmbFetch(url) {
  const wait = GMB_MIN_INTERVAL_MS - (Date.now() - gmbLastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  gmbLastRequestTime = Date.now();
  return (await fetch(url, { cache: "no-store" })).json();
}
```

加上三層快取（路線、站點、ETA），可將每次查詢的 API 請求數降至最低。

---

## 除錯與測試

### 瀏覽器 Console 常用指令

**清空所有快取**：

```javascript
localStorage.clear();
location.reload();
```

**檢查票價資料是否載入成功**：

```javascript
(async () => {
  const r = await fetch("routeFareList.min.json");
  const j = await r.json();
  const src = j.routeList || j;
  const keys = Object.keys(src);
  const gmbKeys = keys.filter(k => {
    const e = src[k];
    const co = Array.isArray(e.co) ? e.co : [];
    return co.map(c => String(c).toLowerCase()).includes("gmb");
  });
  console.log("總路線數:", keys.length);
  console.log("GMB 路線數:", gmbKeys.length);
  console.log("首個 GMB key:", gmbKeys[0]);
  alert("票價檔正常！總路線：" + keys.length + "，GMB：" + gmbKeys.length);
})();
```

**檢查 GMB 站點座標是否載入**：

```javascript
(async () => {
  const r = await fetch("gmb-stops-coords.csv");
  const t = await r.text();
  const lines = t.split(/\r?\n/);
  console.log("座標 CSV 行數:", lines.length);
  console.log("首 3 行:", lines.slice(0, 3).join("\n"));
  alert("座標檔行數：" + lines.length);
})();
```

**檢查目前所選路線的票價**：

```javascript
console.log("currentGmbFare:", currentGmbFare);  // 小巴
console.log("fareDisplay:", fareDisplay);         // 巴士
```

### 常見錯誤

| 錯誤 | 原因 | 解決 |
|---|---|---|
| `Promise {<pending>}` 永遠不變 | 網路封鎖第三方 CDN | 改用本地 `routeFareList.min.json` |
| `HTTP 429` | GMB API 請求過於頻繁 | 等待 1-5 分鐘，或清除快取重試 |
| `HTTP 404` | URL 錯誤或檔案未上傳 | 檢查檔名大小寫，確認檔案在 repo 根目錄 |
| 票價顯示 $0.0 或空白 | 資料未載入或索引失敗 | 執行上述 Console 指令檢查 |
| 地圖不顯示 | 座標轉換失敗或快取舊資料 | 清除 localStorage，重新整理 |

---

## 常見問題

### Q1: 為什麼票價要手動更新？

因為 `routeFareList.min.json` 是從第三方 hkbus.app 下載。你的環境無法直接連線該 CDN，所以需要：
1. 從可以連線的裝置下載
2. 上傳到自己的 GitHub Pages

實務上票價極少變動（一年 1-2 次），每 3-6 個月更新一次就夠。

### Q2: 為什麼小巴分段收費沒實作？

小巴的分段收費是「起點站 + 終點站」的組合定價，而非巴士的「上車站序號」。資料結構複雜度高出許多，且需要重新設計 UI（讓用戶選目的地）。目前僅顯示全程票價。

### Q3: 為什麼有些小巴路線沒有票價？

可能是：
- hkbus.app 的資料庫尚未收錄該路線
- 路線號碼格式不一致（如大小寫、空格）

查詢時可開啟 Console 檢查 `lookupGmbFare()` 的回傳值。

### Q4: 支援離線使用嗎？

**不支援**。ETA 資料需要即時從政府 API 取得。但如果之前有成功載入過票價與座標，這些會從 localStorage 快取讀取。

### Q5: 我可以用在 iOS / Android 嗎？

可以。這是一個**響應式網頁應用**，在手機瀏覽器運作良好。若想要「App 體驗」，可用 WebView 包裝（見下方 APK 說明）。

---

## 未來擴充

### 待實作功能

| 功能 | 優先順序 | 複雜度 |
|---|---|---|
| 渡輪模式 (`ferry.html`) | 高 | 中 |
| 港鐵 (MTR) | 中 | 低 |
| 輕鐵 (Light Rail) | 中 | 中 |
| GMB 分段收費 | 低 | 高 |
| 最愛支援 GPS 快速選取 | 低 | 低 |

### 渡輪 API

新渡輪的即時 API 端點尚未確認。如需實作，請至 [data.gov.hk](https://data.gov.hk) 搜尋「新渡輪」，找到「下一航班預計抵達時間」資料集後，取得實際 API URL。

### 港鐵 API

相對簡單，端點為：

```
https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=<線路代碼>&sta=<車站代碼>
```

線路代碼如 `TWL`（荃灣線）、`KTL`（觀塘線），車站代碼如 `ETS`（尖沙咀）。

---

## Android APK 包裝（可選）

若想提供 APK 給使用者，可用 **WebView 包裝器**：

1. 建立 Android 專案（Kotlin）
2. `MainActivity` 載入 `https://mattpenny.github.io/bus/`
3. 加入 `INTERNET` 權限
4. 應用圖示用 `bus.png`，名稱設為「Ansum Bus」

**關鍵**：APK 只是外殼，內容永遠從 GitHub Pages 載入，所以：
- 使用者**不需重新安裝** APK 就能取得最新版
- 你只需更新 GitHub 上的檔案

---

## 授權

本專案使用社群維護的資料與開源工具，包括：

- [Vue 3](https://vuejs.org/)
- [Leaflet](https://leafletjs.com/)
- [hkbus.app](https://data.hkbus.app/) 票價資料
- 政府資料一線通 API
- 地政總署 CSDI 地圖

僅供個人學習與非商業用途。

---

## 貢獻

發現問題或有建議，請在 GitHub 開 Issue 或 Pull Request。

---

**最後更新**：2026 年 9 月
