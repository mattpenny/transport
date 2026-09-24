# Ansum Transport

香港交通實時到站查詢應用 — 支援巴士、專線小巴，未來將加入渡輪及港鐵。

## 線上版

- **巴士**：[https://mattpenny.github.io/transport/](https://mattpenny.github.io/transport/)
- **專線小巴**：[https://mattpenny.github.io/transport/gmb.html](https://mattpenny.github.io/transport/gmb.html)
- **紅色小巴**：`https://mattpenny.github.io/transport/rmb.html`（**目前 404，尚未上傳**）

---

## ⚠️ 在本機測試時請注意（重要）

**不要用雙擊方式直接開啟 `index.html` / `gmb.html` / `rmb.html`。**

直接用雙擊開啟時，網址是 `file://...`，瀏覽器基於安全理由會**封鎖本機 JSON／CSV 檔案的讀取（CORS）**，
結果就是：頁面只顯示未渲染的 `{{ ... }}` 模板文字，或票價／路線／站點全部空白。

### 正確做法（Windows 最簡單）

雙擊資料夾內的 **`start-local.bat`**，它會自動：
1. 啟動本機網頁伺服器（優先使用 Python，找不到時自動改用 Node.js）
2. 開啟瀏覽器到 `http://localhost:8000/index.html`

### 或手動啟動

任選一種：

```bash
# Python（版本 3）
python -m http.server 8000

# Node.js（無需安裝任何套件）
node tools/serve.js 8000
```

然後瀏覽器前往 `http://localhost:8000/index.html`。

> 若透過 `file://` 開啟，頁面會自動顯示一個紅色警告框提醒你改用本機伺服器，
> 不會再只顯示一堆看不懂的模板文字。

---

## 目錄

1. [功能總覽](#功能總覽)
2. [檔案結構](#檔案結構)
3. [部署步驟](#部署步驟)
4. [技術架構](#技術架構)
5. [資料來源](#資料來源)
6. [紅色小巴頁面架構](#紅色小巴-rmbhtml-頁面架構)
7. [路線詳細資料彈窗](#路線詳細資料彈窗詳請)
8. [目的地搜尋](#目的地搜尋indexhtml-與-gmbhtml-的查詢)
9. [模板綁定靜態檢查](#模板綁定靜態檢查toolscheck-bindingspy)
10. [關鍵實作細節](#關鍵實作細節)
11. [除錯與測試](#除錯與測試)
12. [常見問題](#常見問題)
13. [未來擴充](#未來擴充)

---

## 功能總覽

| 功能 | 巴士 (`index.html`) | 專線小巴 (`gmb.html`) | 紅色小巴 (`rmb.html`) | 渡輪 (`ferry.html`) |
|---|:---:|:---:|:---:|:---:|
| 路線搜尋 | ✅ | ✅（自動判定地區；號碼重複才彈窗問） | ✅（按地區＋關鍵字） | 🚧 |
| 目的地搜尋（附近 5 個可到達的車站） | ✅ 需定位（含小巴，不可點） | ✅ 需定位（只列小巴） | ❌ | 🚧 |
| 方向選擇 | ✅ | ✅ | ✅（行車方向） | 🚧 |
| 站點列表 | ✅ | ✅ | ⚠️ 只列行車路線（`via` 文字） | 🚧 |
| 實時到站 (ETA) | ✅ 最近 3 班 | ✅ 最近 3 班 | ❌ 紅巴無官方 ETA | 🚧 |
| 全程票價 | ✅ | ✅ | ✅（收費表） | 🚧 |
| 分段收費 | ✅ | ❌ | ❌ | ❌ |
| 路線詳細資料（「詳請」彈窗） | ✅ | ✅ | ✅（右欄內嵌） | 🚧 |
| 地圖顯示 | ✅ | ✅ | ❌ | 🚧 |
| GPS 自動定位最近站 | ✅（見「目的地搜尋」） | ✅（見「目的地搜尋」） | ❌ | 🚧 |
| 我的最愛 | ✅ 6 個 | ✅ 6 個 | ✅ 6 個 | 🚧 |
| 字型大小調整 | ✅ | ✅ | ✅ | 🚧 |
| API 節流保護 | — | ✅（防 429） | —（純靜態 JSON） | — |

> **紅巴為何沒有 ETA／地圖？** 紅色小巴沒有政府實時到站 API，亦無官方站點座標，
> 資料來源是 16seats.net 的路線目錄（`rmb-routes.json`），因此頁面改為
> 「地區 → 路線 → 詳細資料（收費表、時間表、行車路線）」的純目錄式瀏覽。

---

## 檔案結構

在 GitHub Pages 的根目錄應包含：

```
你的 repo/
├── index.html                  ← 巴士模式主頁
├── gmb.html                    ← 專線小巴模式
├── rmb.html                    ← 紅色小巴模式
├── bus.png                     ← 巴士應用圖示
├── gmb.png                     ← 專線小巴圖示
├── rmb.png                     ← 紅色小巴圖示
├── gmb-stops-coords.csv        ← 全港 GMB 站點座標（政府靜態資料）
├── gmb-detail.json             ← GMB 收費／站點／營運資料（運輸署開放數據）
├── rmb-routes.json             ← 紅色小巴路線目錄（16seats.net）
├── routeFareList.min.json      ← 票價資料（從 hkbus.app 手動下載）
├── bus-detail.json             ← 巴士班次（服務日 → 時段 → 班距），由下方工具產生
├── start-local.bat             ← 本機啟動器（Windows，雙擊即可）
├── tools/
│   ├── fetch-td-gmb.py         ← 由運輸署開放數據產生 gmb-detail.json
│   ├── fetch-16seats.ps1       ← 抓取 16seats.net 資料（紅色小巴目錄）
│   ├── build-bus-detail.py     ← 由 routeFareList.min.json 產生 bus-detail.json
│   ├── check-bindings.py       ← 靜態檢查：模板綁定 vs setup() 匯出（見下節）
│   └── serve.js                ← 極簡本機靜態伺服器（Node.js 備援）
└── README.md                   ← 本文件
```

> **三個交通模式都必須上傳**（`index.html`、`gmb.html`、`rmb.html`）以及對應的
> `bus.png`、`gmb.png`、`rmb.png`。缺任何一個都會令首頁連結或圖示變成 404 —
> 目前線上版本正缺少 `rmb.html`、`gmb.png`、`rmb.png`（見「部署狀態提醒」）。

### 各檔案用途

| 檔案 | 用途 | 更新頻率 |
|---|---|---|
| `index.html` | 巴士介面（單一檔案，含 HTML + CSS + JS） | 只在改功能時 |
| `gmb.html` | 專線小巴介面（單一檔案） | 只在改功能時 |
| `rmb.html` | 紅色小巴介面（單一檔案） | 只在改功能時 |
| `bus.png` / `gmb.png` / `rmb.png` | 各模式應用圖示（favicon 與 header logo） | 極少 |
| `gmb-detail.json` | GMB 收費／站點／營運資料（**運輸署開放數據**） | 每 2 週（官方更新頻率） |
| `rmb-routes.json` | 紅色小巴路線目錄（16seats.net） | 不定期 |
| `gmb-stops-coords.csv` | GMB 站點 HK80 座標 | 每 3-6 個月 |
| `routeFareList.min.json` | 全港巴士與小巴票價 | 每 3-6 個月 |
| `bus-detail.json` | 巴士班次（服務日／時段／班距），只供「詳請」彈窗使用 | 與 `routeFareList.min.json` 同步重跑 |

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
- `rmb.html`
- `bus.png`、`gmb.png`、`rmb.png`
- `gmb-detail.json`
- `gmb-stops-coords.csv`
- `rmb-routes.json`
- `routeFareList.min.json`

### 3. 驗證

在瀏覽器開啟：

```
https://<你的帳號>.github.io/<repo>/
```

應看到巴士介面。點「專線小巴」應跳到 `gmb.html`，點「紅色小巴」應跳到 `rmb.html`。

逐個資產快速檢查（把 `<網址>` 換成你的 Pages 根網址）：

```bash
for p in / /index.html /gmb.html /rmb.html /bus.png /gmb.png /rmb.png; do
  printf "%s  %s\n" "$(curl -s -o /dev/null -w '%{http_code}' "<網址>$p")" "$p"
done
```

全部應為 `200`；任何 `404` 都代表該檔案未上傳或檔名大小寫不符。

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
| 我的最愛（專線小巴） | localStorage + cookie | `hk-gmb-favourites-v1` |
| 我的最愛（紅色小巴） | localStorage + cookie | `hk-rmb-favourites-v1` |
| 字型大小（三者共用） | localStorage + cookie | `hk-bus-font-scale` |
| 彈窗字型大小（僅巴士詳請彈窗） | localStorage + cookie | `hk-bus-detail-font-scale` |
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
| GMB 收費／站點／營運資料 | [運輸署開放數據](https://data.gov.hk/tc-data/dataset/hk-td-tis_3-routes-and-fares-of-public-transport) | Access MDB → 轉成 JSON |
| 票價 | [hkbus.app](https://data.hkbus.app/routeFareList.min.json) | JSON |
| GMB 站點座標 | [data.gov.hk](https://data.gov.hk) | CSV（HK80 座標） |
| 地圖底圖 | 地政總署 CSDI | PNG 瓦片 |
| 地圖標籤 | 地政總署 CSDI | PNG 瓦片 |

### 更新週期

| 資料 | 原始更新頻率 | 建議手動更新頻率 |
|---|---|---|
| ETA | 每分鐘 | — |
| 票價 | 每日（hkbus.app） | 每 3-6 個月 |
| GMB 收費／站點（運輸署） | 每兩週 | 每 1-2 個月 |
| GMB 站點座標 | 每兩週（政府） | 每 6 個月 |
| 路線清單 | 不定期 | — |

---

## GMB 詳細資料：如何從運輸署開放數據重建

`gmb-detail.json` 由 **`tools/fetch-td-gmb.py`** 從運輸署開放數據產生。

```bash
# 需要 access-parser
pip install access-parser

# 下載 + 轉換（會覆寫 gmb-detail.json）
python tools/fetch-td-gmb.py

# 只用已下載的 .mdb 快取（離線重跑）
python tools/fetch-td-gmb.py --offline

# 保留 .mdb 快取以便反覆測試
python tools/fetch-td-gmb.py --keep-mdb
```

### ⚠️ 重要陷阱：CSV 是「差異檔」，不是資料

data.gov.hk 上該資料集同時提供 CSV 與 MDB。**CSV 只是變更記錄**
（欄位僅 `ROUTE_ID,CHANGE`，值為 `ADD`/`UPDATE`），**真正的資料在 `.mdb`（Access）檔案內**。
網頁上要先在格式篩選器選「MDB」才會看到。

| 檔案 | 內容 |
|---|---|
| `ROUTE_GMB.mdb` | 路線號、起訖點（中英）、全程收費、行車時間、地區 |
| `FARE_GMB.mdb` | 完整分段收費矩陣（`ON_SEQ` 上車、`OFF_SEQ` 下車、`PRICE`） |
| `RSTOP_GMB.mdb` | 各線站序與站名（中英） |
| `STOP_GMB.mdb` | 站點座標（HK80 格網） |
| `COMPANY_CODE.mdb` | 公司代號對照 |

### 兩個實作要點

1. **金額格式**：`PRICE` / `FULL_FARE` 是 **1/10000 港元**的整數。
   `145000` → `$14.50`。
2. **`ON_SEQ` 是上車站、`OFF_SEQ` 是下車站**（不是反過來）。
   若標籤寫成「由 OFF 往 ON」就會出現「往起點」的錯誤方向。

### 已知限制

- **班次時間表不在開放數據內**：該資料集沒有頻率／班次表。
  路線頁連結（`ROUTE.HYPERLINK_C`）會指向運輸署「香港出行易」官方頁，
  該頁才有時間表。前端在沒有時間表資料時會自動隱藏該卡片。
- **個別營辦商名稱不在開放數據內**：只有通用的 `GMB`（專線小巴）代號，
  沒有逐線營辦商名稱。

### 授權（可公開發布）

DATA.GOV.HK 使用條款 v1.2 允許**商業及非商業**用途、免費使用，條件是
註明資料來源並確認政府知識產權。`gmb-detail.json` 內的
`source` / `sourceName` / `copyright` / `licence` 欄位已寫入相關聲明。

> 舊版資料來自 16seats.net，其版權為「僅供個人非商業參考」，不可公開發布。
> 已備份為 `gmb-detail.16seats.backup.json`。

---

## 紅色小巴 (`rmb.html`) 頁面架構

紅巴沒有 API，所以這一頁是本專案**唯一純靜態**的模式：只讀一個 `rmb-routes.json`，
不做任何 ETA 請求。整體佈局刻意與 `gmb.html` 對齊，讓三個模式的操作習慣一致。

### 操作流程

```
選地區  →  路線清單  →  路線詳細資料
（左欄）   （右欄／手機在同一欄下方）  （桌面內嵌／手機彈出）
```

| 步驟 | 桌面（> 900px） | 手機（≤ 900px） |
|---|---|---|
| 1. 選地區 | 左欄**內嵌**地區格線（3 欄） | 同樣是內嵌地區格線 |
| 2. 選路線 | 路線清單出現在**右欄** | 路線清單接在下方同一捲動欄 |
| 3. 看詳情 | 右欄**內嵌**展開詳細卡片 | **彈出**全螢幕面板（GMB 的「詳請」樣式） |

### 關鍵設計：一份 markup，兩種呈現

詳細資料**只寫一次**（`.detail-stack > .detail-sheet`），靠 CSS 切換桌面內嵌／手機彈出：

```css
.detail-sheet { display: contents; }          /* 桌面：卡片直接融入右欄 */

@media (max-width: 900px) {
  .detail-stack        { display: none; }     /* 手機：預設收起 */
  .detail-stack.open   {                      /* 選路線後變成固定浮層 */
    display: flex; position: fixed; inset: 0; z-index: 4000;
    background: rgba(0,0,0,0.5); /* 半透明背景遮罩 */
  }
  .detail-stack.open .detail-sheet {
    display: flex; flex-direction: column;
    height: var(--modal-max-h, calc(100dvh - 16px));
    border-radius: 12px; overflow: hidden;
  }
}
```

`display: contents` 讓 `.detail-sheet` 這一層在桌面「消失」（子元素直接成為 flex 子項），
在手機才變成真正的面板盒。**好處：不必維護兩份幾乎相同的 ~90 行詳細卡片 markup。**

手機彈出面板的高度用 `--modal-max-h`，由 JS 依 `window.visualViewport.height` 計算，
避開 iOS Safari 網址欄造成的 `100vh` 偏差：

```javascript
function updateModalMaxHeight() {
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const pad = window.matchMedia("(max-width: 600px)").matches ? 16 : 40;
  document.documentElement.style.setProperty("--modal-max-h", Math.max(240, vh - pad) + "px");
}
```

### 響應式切換

```javascript
const isMobile = ref(window.matchMedia("(max-width: 900px)").matches);
// selectRoute()：手機才開彈出，桌面維持內嵌
if (isMobile.value) { updateModalMaxHeight(); detailOpen.value = true; }
else                { detailOpen.value = false; }
```

`matchMedia` 的 `change` 事件會同步 `isMobile`；由窄轉寬時自動 `detailOpen = false`，
避免「桌面模式仍留著一個已開啟的彈出層」。按 `Esc` 亦可關閉彈出。

### 首頁提示何時消失

```javascript
const isLanding = computed(() =>
  !current.value && !isSearching.value && !loading.value && !regionId.value
);
```

`regionId` 是關鍵：**一旦選了地區，「可選擇其他交通工具」提示就會收起**，
路線清單緊貼在搜尋列下方，不會被首頁文案隔開。

### 常數

| 常數 | 值 | 說明 |
|---|---|---|
| `DATA_URL` | `rmb-routes.json` | 唯一資料來源 |
| `FAV_STORAGE_KEY` | `hk-rmb-favourites-v1` | 最愛 |
| `FONT_SCALE_KEY` | `hk-bus-font-scale` | 與其他模式**共用**字型設定 |
| `MAX_FAVOURITES` | `6` | 與其他模式一致 |
| `MIN_FONT_SCALE` / `MAX_FONT_SCALE` | `0.8` / `1.6` | 縮放上下限 |
| `SOURCE_URL` | `https://www.16seats.net/chi/rmb/` | 資料來源連結 |

---

## 路線詳細資料彈窗（「詳請」）

巴士頁搜尋列上有一顆「詳請」按鈕（**選定行車方向之後才出現**），按下會彈出
路線詳細資料。這個彈窗刻意與 `gmb.html` 的「詳請」**同一套樣式、同一個尺寸**：
寬 `720px`（窄螢幕 `max-width: 100%`）、高 `var(--modal-max-h)`
（由 `updateDetailModalMaxHeight()` 依 `visualViewport` 算出，扣掉上下留白）。

關閉方式三種，與 GMB 一致：右上 ✕、點遮罩、按 Esc。

### 內容區塊

| 區塊 | 內容 | 資料來源 |
|---|---|---|
| 服務日 chips | 該路線真的有的服務日（例：星期一至五／星期六／星期日） | `bus-detail.json` 的 `days`／`freq` |
| 行車方向 chips | 沿用側欄那份 `matchedRoutes`，選了就呼叫原本的 `selectDirection()` | ETA API 路線清單 |
| 💰 收費表 | 全程收費，加上「票價與上一站不同」的站各一列「由 XXX 起」 | 票價索引（記憶體內） |
| 🕒 服務時間及班距 | 逐時段「HH:MM – HH:MM ＋ 每 N 分鐘」 | `bus-detail.json` |
| 🗺️ 沿途車站 | 站序 ＋ 站名，依行車次序 | 票價索引的 `stopsMap` ＋ ETA 站名 |
| ℹ️ 營辦商／資料來源 | 營辦商、路線、起訖點、（特別班次）、車站數目、版權聲明 | 記憶體內 |

逐站票價只在**價位改變**的位置才列一行。票價檔是逐站票價，同一個價位會連續
重複很多筆（1 號線 24 筆裡只有 2 個價位），全列出來只是噪音。

### 為什麼班次資料要獨立成 `bus-detail.json`

實測本機 Chrome 的 localStorage 配額只剩約 **100 KB**，而票價快取
（`hk-bus-fare-data-v5`）已經佔掉約 5.12 MB。巴士班次資料約 0.66 MB ——
併進票價快取會令**整個快取寫入失敗**（`setItem` 拋錯後被 `catch` 吞掉），
反而讓每次載入都要重抓 8 MB 的 `routeFareList.min.json`。

所以班次拆成獨立小檔，而且**只在使用者第一次按「詳請」時才抓**
（`fetchBusDetailDb()`，與 `gmb.html` 的 `gmbDetailDb` 一樣只放記憶體、不寫 localStorage）。

重新產生（來源檔換了就要重跑）：

```bash
python tools/build-bus-detail.py                      # routeFareList.min.json → bus-detail.json
python tools/build-bus-detail.py 來源.json 輸出.json
```

產出約 0.66 MB、1,340 條路線、26,585 個時段、10 種服務日標籤。

### ⚠️ 順手修好一個既有 bug：回程顯示去程票價

`lookupFareEntry(route, company, serviceType)` **原本沒有比對行車方向**。
同一條線的兩個方向在票價檔是**兩筆**，逐站票價不同，而原查詢會
`candidates.find(c => c.companyList.includes(co))` 命中第一筆 ——
於是**回程永遠顯示去程的票價**。

實測：2,118 個 `route+serviceType` 組合裡有 **1,022 個**有兩個方向，
也就是近半路線受影響。以 1 號線為例，去程第 17 站起 $5.8、回程第 9 站起 $6.3，
原本在回程會看到 $5.8。側欄的票價列（`computeBoardingFare`）也一起吃這個錯。

修法（`index.html`）：

1. `lookupFareEntry()` 增加第 4 個參數 `direction`，先按方向篩候選。
2. `loadFare()` 與 `detailFareKey` 都傳入 `r.direction`。
3. 票價檔的 `bound` 是**逐公司**的（同一筆可以是 `{kmb:"O", ctb:"I"}`），
   但索引只存一個字串（配額問題，見上）。新增 `packBound()`：各公司一致時
   就存那個值（絕大多數），不一致時才存 `"kmb:O|ctb:I"`；`entryBoundFor()`
   負責還原成「這間公司的方向」。`buildGeoIndex()` 的 `routeStopIdx` 也要改用
   `entryBoundFor(e, co)`，否則下游用 `route+bound+serviceType` 組出來的鍵
   會對不上 `matchedRoutes` 的 `route+direction+serviceType`。
4. 篩不到就**維持舊行為**（回退到不篩），所以不會因為新參數而查不到票價。
   `"OI"`／`"IO"`（環線，兩個方向共用一份票價）兩個方向都收。

代價：票價快取由 5,120,430 字元增至 **5,121,526 字元**（+1,096），仍在配額內。

### 站名優先用側欄那一份（ETA），不是 geoIndex

彈窗的「沿途車站」與票價列的「由 XXX 起」都用 `detailStopNames`。它有三個來源，
優先次序如下：

1. **ETA API**（側欄那份，`stops.value`）—— 官方站名。
2. **`geoIndex`** —— 票價檔的車站編號要反查站名時用的索引。
3. 最後才退回公司車站編號，至少不會空白。

`geoIndex.rev` 是 **last-write-wins**：同一個公司站號會對到多筆內部站記錄
（1 號線第一站的 kmb 站號在 `stopMap` 出現 7 次，最後一筆才勝出），
所以名稱會挑到其中一個站柱 —— 例：`旺角奶路臣街` 變成 `旺角`、
`竹園邨總站` 變成 `竹園邨巴士總站`。

因此規則改成：**站數一樣時優先用 ETA 站名**（兩邊都是同一條線、同一方向、
同一次序；站數一樣代表沒有被 `stops.value` 的「必須有座標」過濾掉任何一站），
而且要 `every(Boolean)` 全部有名才採用，避免出現「一半 ETA 名、一半站柱名」的
混合清單。站數不同就整份退回 `geoIndex`，絕不硬湊位次。

> 換方向時 `selectDirection()` 會先清空 `stops.value`，載回來之前站名會短暫
> 退回 `geoIndex` 名，載完自動換回 —— 屬預期行為。

### 為什麼每張卡都有自己的類名

四張卡是 `.detail-card` ＋ `.card-fare` / `.card-timetable` / `.card-stops` /
`.card-operator`，營辦商那幾列用 `.op-row` / `.op-label` / `.op-value`
（**不是** `.tt-row` / `.tt-time`）。

原因：第一版四張卡共用 `.tt-row`，於是 `.detail-card .tt-row` 這種選取器
會**同時命中營辦商卡**，令驗證把「九巴」「25 站」當成班次列，斷言互相污染。
類名分開之後，選取器（包括人工在 Console 查）都能明確指到某一張卡。

### 相關常數與函式

| 名稱 | 說明 |
|---|---|
| `BUS_DETAIL_URL` | `bus-detail.json` |
| `fetchBusDetailDb()` | 只抓一次、記憶體快取；失敗回 `null` |
| `lookupFareKey(route, co, serviceType, direction)` | 由物件身分反查票價索引的鍵（索引沒存鍵，省約 130 KB） |
| `packBound()` / `entryBoundFor()` | 逐公司行車方向的壓縮／還原 |
| `stopNameForCompanyId()` | 公司車站編號 → `geoIndex` 站名 |
| `formatHHMM()` / `formatHeadway()` | `"0535"` → `05:35`；`900` 秒 → `每 15 分鐘` |
| `updateDetailModalMaxHeight()` | 依 `visualViewport` 設定 `--modal-max-h` |
| `openDetail()` / `closeDetail()` / `pickDetailDirection()` | 彈窗控制 |
| `increaseDetailFontSize()` / `decreaseDetailFontSize()` | 彈窗內 +／−，驅動 `--modal-font-scale` |

`detailReady` 在**載入失敗時也會設為 `true`**，否則每次開彈窗都會重試抓檔。

### 彈窗專用字型大小（+／−，與全頁獨立）

彈窗 header 右側有 +／− 按鈕，**只放大這份彈窗的內容**，不會連側欄、路線
清單、最愛、地圖一起放大。實作：CSS 變數 `--modal-font-scale`（預設 `1`），
所有彈窗樣式都從 `var(--font-scale)` 換成 `var(--modal-font-scale)`。

與全頁 `--font-scale` 共存：header 的 +／− 仍是全頁的，彈窗的 +／− 是獨立的，
鍵分別是 `hk-bus-font-scale` 與 `hk-bus-detail-font-scale`。範圍都是 0.8–1.6。
`updateDetailFontScale()` 與全頁 `updateFontScale()` 同結構，clamping 行為一致。

預設字型也比初版調大（`--font-scale=1` 仍是基準，但基準本身從 12px → 15px）：
收費表 20→22px、表內文字 12→15px、卡片標題 14→16px、chips 12→14px、
小標籤 11→13px。

---

## 目的地搜尋（`index.html` 與 `gmb.html` 的「查詢」）

兩個頁面都只有一個「查詢」按鈕，行為取決於輸入內容：

| 輸入 | 行為 |
|---|---|
| 路線號（`1A`、`N691`、`962X`、`27M`…） | 顯示該路線（原有流程） |
| 其他（`旺角`、`銅鑼灣`、`Causeway Bay`…） | **目的地搜尋**：彈出「往該目的地的最近 5 個車站」 |

判斷方式為 `looksLikeRouteNumber()`（`/^[A-Z]{0,2}\d{1,4}[A-Z]?$/i`），
兩個檔案各有一份同名實作。

### 兩頁的差異一覽

| | `index.html`（巴士） | `gmb.html`（專線小巴） |
|---|---|---|
| 索引來源 | `buildFareIndex()` + `buildGeoIndex()` | `buildGmbGeoIndex()` |
| 索引涵蓋公司 | 全部（kmb / ctb / nlb / gmb…） | 只有 `gmb` 有 `routeStopIdx` |
| 方向判斷依據 | `fareIndex[routeId].stopsMap[公司]` 的索引 | `routeStopIdx[].pos`（見下） |
| 結果路線 | 巴士**可點**；小巴虛線籤、`disabled` | 小巴**可點**；不含巴士 |
| 結果面板底部提示 | 「標示『專線小巴』的路線請到『專線小巴』頁查看」 | 「本頁只列出專線小巴路線；巴士路線請到『巴士路線』頁查看」 |
| 點籤後 | 切換公司並開路線 | 先查出**地區**再開路線（見下） |
| 輸入路線號後 | 桌機：一次查三間公司；手機：公司重複才彈窗 | 兩種寬度都會**自動判定地區**，號碼重複才彈窗（見下） |
| 路線籤票價 | `chipFareText(routeId)` —— `routeId` 就是票價索引的鍵 | `gmbChipFareText(r)` —— 先用 gtfsId 精確查（見下） |
| 桌機結果面板 | `main.main-area` 右欄（`.place-panel`） | 同左 |

> **為何 GMB 頁不列巴士路線？** GMB 頁的 geo 索引只收錄小巴關聯（約 9,000 筆、
> 2.7 MB，塞得進 localStorage）；若改成全公司版本會膨脹到 7.4 MB，
> 超過 localStorage 上限而令快取靜靜地失效。巴士結果在 `index.html` 已可看到。

### 「最近」是相對使用者位置

`findStopsToDestination()` 以 `navigator.geolocation` 取得的位置為中心，
由內至外放寬半徑（`DEST_RADII = [400, 800, 1500]` 米），
回傳**離使用者最近**、而且**有車去該目的地**的 5 個車站。

### ⚠️ 最關鍵的一步：方向必須正確

候選車站必須在「同一條路線、同一方向」上排在目的地**之前**，否則會推薦反方向的班次
（「近」不等於「方向對」）。

```
同一條路線的站序：   A ── 候選站 ── … ── 目的地站 ── B
                              ↑ 合格（pos < earliest）
                                        ↑ 不合格（pos >= earliest，已經過站）
```

少了這個檢查，中環就會推薦「往屯門方向」的路線去旺角。回歸測試會驗證
每一組 (車站, 路線) 都滿足 `pos(車站) < pos(最早的目的地站)`。

兩頁取得「站序」的方式不同：

- **`index.html`**：`fareIndex[routeId].stopsMap[公司]` 是**有序**陣列，
  每次查詢時即時建立 `internalId → 索引` 的對照表（`orderByKey`）。
- **`gmb.html`**：建立索引時就把站序寫進 `routeStopIdx[].pos`，查詢時直接比大小。

#### 為何小巴一定要用 `pos`，不能只看路線編號

巴士的 `routeId` 每個方向各自一組，但小巴的 `gtfsId`（＝GMB API 的 `route_id`）
**同時涵蓋去回程** —— `routeFareList.min.json` 內 772 個小巴 `gtfsId` 有 382 個
對應兩筆 `routeList`（`bound` 分別為 `O` / `I`）。所以小巴的方向鍵必須是
**路線號 + `bound` + `serviceType`** 一組，`pos` 也必須取自該 `bound` 自己的站序表，
否則會把回程的站序當成去程用，推薦出反方向的班次。

#### 路線籤點了之後：三層查出「地區」（只有 `gmb.html` 需要）

`gmb.html` 的 `fetchGmbRouteDetails(region, route)` 必須先知道地區，而同一個路線號
可以在不同地區各有一條（例如「1」在港島是「中環–山頂」）。`resolveGmbRegion()`
由便宜到貴依序嘗試，並把結果記進 `gmbRegionCache`：

| 次序 | 來源 | 成本 | 覆蓋率 |
|---|---|---|---|
| 1 | `gmb-detail.json` 的 `td_route_id`（唯一值） | 本機檔案 | 562 / 772 |
| 2 | `GET /route`（一次約 3.5 KB）回傳的路線號 → 地區 | 1 個請求 | 累計 691 / 772 |
| 3 | 逐區 `GET /route/{地區}/{路線號}` 探測 | 最多 3 個請求 | 全部 |

第 3 步只探「該路線號可能所屬」的地區（由第 2 步的清單收窄），而不是盲試三個地區。

`bound` 是 `O` / `I`，而 API 的 `route_seq` 是 `1` / `2`（專案其他地方
`loadGmbFareForCurrentRoute()` 已有同樣的對應），所以點籤後可以直接選好方向；
對不上就讓使用者自己從方向清單挑。

#### 輸入路線號之後：地區按鈕平常不顯示，號碼重複才彈窗（只有 `gmb.html`）

側欄原本常駐一排「港島 / 九龍 / 新界」三格按鈕。問題是**大部分號碼只屬一個地區**，
那排按鈕九成時間都是白佔位；使用者還得先猜地區、猜錯就查不到。
現在改成：**平常一個地區按鈕都沒有**，只在必要時才問。

```
輸入「69X」  →  只有港島有這條線  →  直接查，不問
輸入「1」    →  港島、新界都有    →  彈窗（2 格）
輸入「12」   →  港島、九龍、新界都有 →  彈窗（3 格）
輸入「9999」 →  三個地區都沒有    →  不彈窗，走「找不到小巴路線」
輸入「旺角」 →  不像路線號碼      →  走目的地搜尋（與地區無關）
```

判斷用 `findRegionsForRoute(code)`，資料來自同一個 `GET /route` 清單
（`fetchGmbRegionsByCode()`，一次請求後快取）：

| 命中地區數 | 行為 |
|---|---|
| 1 | 直接把 `region` 設成它，立刻查（最常見，392 / 479 個號碼） |
| ≥ 2 | 開彈窗，列出**實際有這條線的地區**，選完立刻查（87 個號碼，其中 6 個三區都有） |
| 0 | 照原流程查一次 → 由「找不到小巴路線」提示接手 |
| 清單拿不到（離線） | 用目前地區直接查，不擋使用者 |

彈窗只列**真的有這條線**的地區：輸入「1」（港島＋新界）只會看到兩格，
不會出現九龍。副標題把地區名唸出來 ——「路線 12（港島、九龍、新界都有這條線）」，
使用者一眼就知道為何要問。

**與巴士頁（`index.html`）的異同**：兩頁都是「重複才問」的同一套邏輯，但巴士頁的
「選擇巴士公司」彈窗只在**手機**出現（桌機一次查三間公司，不必問）；
小巴頁因為 API 一定要指定地區，**兩種寬度都需要彈窗**，所以
`.region-overlay` 刻意寫在 `@media` 之外。

彈窗本身重用原本那三格地區按鈕（`.region-btn`），所以外觀與從前一致，
只是從常駐變成按需要出現；目前地區以 `.active` 標示。關閉方式有三種：
右上 `✕`、點擊遮罩、按 `Esc`。

> **關閉＝取消這次查詢。** `closeRegionPicker()` 會把 `searched` 收回 `false`，
> 否則側欄會留下一句「找不到小巴路線『12』」—— 那並不是事實。
>
> 從目的地結果點路線籤時（`placePickRoute()`）**不會**再走一次這個判斷：
> 那裡已經用 `resolveGmbRegion(item.routeId)` 從 `gtfsId` 精確得知地區，
> 直接呼叫 `runRouteSearch()` 查，免得對一條明明知道地區的路線又問一次。
> 同理，`onSearch()` 因此拆成兩層：`onSearch()` 只負責「決定地區」，
> `runRouteSearch()` 負責「用已定的地區去查」。

### 定位失敗時的行為（誠實降級）

定位被拒絕／逾時**不會**令搜尋失敗，而是改用「目的地車站的座標中位數」當中心，
並在副標題如實標示 **「未取得位置 · 以目的地為中心」**，不會假裝那是「你附近」。
真的連車站都找不到時，才把定位錯誤顯示成紅色錯誤框。

### GMB（專線小巴）會一併出現，但**不可點擊**（僅 `index.html`）

`buildGeoIndex()` 走訪票價檔內**所有**公司，所以 GMB 的 8,978 個站／路線關聯
（`routeStopIdx` 內 `gmb`）本來就在索引內。但 `index.html` 只載入 KMB／CTB／NLB
的路線清單，**沒有小巴路線清單可開**，因此：

- GMB 路線以**虛線外框 + 淺底**的籤顯示，標籤為「專線小巴」，並設 `disabled`；
- 清單底部另有一行提示，請使用者到「專線小巴」頁查看。

> 舊版的 `placeRowsFor()` 有一行 `if (target === "GMB") continue;` 直接略過小巴，
> 現已移除 —— 需求改為「小巴也要出現，但要標示清楚」。

### 為何同一個路線號只出現一次

同一條路線號在同一站可能有多個 `bound`／`serviceType`（去程／回程／特別班次），
它們都會通過方向檢查，但對使用者而言就是「同一條線」。
因此按 **路線號 + 公司** 去重，否則會出現三張一模一樣的籤。

### 結果面板的位置：桌機在右欄，手機才是彈出層

結果面板**不在** 340px 側欄，而是與「路線詳細資料」同一區塊 —— 佔滿右欄原本地圖那一列：

```
桌機（>900px）                     手機（≤900px）
┌────────┬──────────────┐         ┌──────────────┐
│ 側欄    │ 目的地結果    │         │ 側欄          │
│        │ .place-panel  │         └──────────────┘
└────────┴──────────────┘         ＋全螢幕 .gps-overlay
```

- markup 只寫一份，靠 `main.main-area` 上的 `.showing-place` 類別切換：
  該類別把 `.map-wrap-desktop` 與 `.eta-box` 設成 `display:none`，
  並把 `grid-template-rows` 由 `minmax(0,1fr) auto` 改成單列。
- **規則只寫在 `@media (min-width: 901px)` 內**。手機的 `.main-area` 是
  `display: contents`，若不加這個條件，`.eta-box` 會被一起隱藏，
  手機的候車時間面板就會消失。
- 手機仍用原本的全螢幕 `.gps-overlay`（Teleport 到 `body`）；
  既有的 `.gps-panel { display: none }`（≤900px）正好一併隱藏 `.place-panel`。

> ⚠️ **Leaflet 容器不能 `v-if`。** 地圖是用 `display:none` 蓋掉的，
> `#map-desktop` 必須留在 DOM 內，否則 Leaflet 實例會被銷毀。
> 收起結果時容器由 0×0 變回原尺寸，所以 `setup()` 內有一個 `watch`
> 監看「結果是否顯示」，在收起後 `nextTick` 呼叫 `mapDesktop.invalidateSize()`。
> 少了這一步，地圖會留下一片空白，直到使用者縮放視窗才恢復。

#### 桌機卡片尺寸約為側欄版的兩倍

原本的尺寸是為 340px 側欄調的，搬到 700px 以上的右欄就顯得過小。
所以桌機（`min-width: 901px`）另外把字級與內距放大約一倍 ——
**這些覆寫全部寫在該 media query 內，手機彈出層完全不受影響**：

| 元素 | 側欄／手機 | 桌機右欄 |
|---|---|---|
| 車站名 `.dest-stop-name` | 13.5px | **28px** |
| 距離 `.dest-stop-dist` | 12px | **20px** |
| 路線籤 `.dest-route-chip` | 12px、`4px 8px` | **22px、`10px 18px`**（實測高 50px） |
| 票價 `.chip-fare` | 11px | **19px** |
| 車站列 `.dest-stop` 內距 | `9px 12px` | **`18px 24px`** |
| 面板標題 `.gps-title` | 14px | **24px** |

另外桌機的 `.gps-head` 加了 `flex-wrap: wrap`，並用 `order` + `flex-basis: 100%`
把副標題換到第二行 —— 24px 標題與 16px 副標題擠在同一行會折行折得很難看。
關閉鈕留在第一行右側。

放大之後清單會超出一屏而需要捲動，這是預期的（`.dest-list` 本來就是
`flex: 1 1 auto; overflow-y: auto`）。

點路線籤之後面板也會收起（`index.html` 在 `placePickRoute()` 內清 `placeResults`；
`gmb.html` 走的 `onSearch()` 本來就會呼叫 `clearPlace()`），
否則剛打開的路線地圖會被面板蓋住。

#### 側欄底部的「可選擇其他交通工具」（`gmb.html`，桌機常駐）

這個切換其他交通工具的區塊原本寫成 `v-if="isLanding"`，
`isLanding = !searched && !routeInput.trim() && !stops.length` ——
**只要在輸入框打一個字，整區就消失**，使用者常常找不到它。

現在條件是：

```html
<div v-if="!isMobile || isLanding" class="other-modes">
```

- **桌機**：永遠顯示。
- **手機**：仍然只在 landing 出現 —— 手機的側欄是整頁長捲動，
  常駐這區只會拉長捲動距離；桌機側欄本來就有大片空位，常駐沒有成本。

同時把整個區塊從「搜尋列」與「方向」之間**搬到側欄最後**。原本的位置在
有路線載入時會變成「搜尋列 → 其他交通工具 → 方向 → 沿線小巴站」，把流程切斷；
搬到最後之後順序是「搜尋列 → 方向 → 沿線小巴站 → 其他交通工具」，
而 landing 時後面本來就是空的，外觀與從前一致。

`.other-modes` 另外補了 `flex-shrink: 0`：側欄是 flex column，
而 `.stop-list` 是 `flex: 1 1 auto`，沒有這行的話視窗變矮時這區會被壓扁
（與 `.gps-panel` 同一個坑）。

> `index.html` 目前**沒有**跟進：它用的是 `v-if="!searched"`，行為與改動前的
> `gmb.html` 相同（打路線號搜尋後收起）。若要比照辦理，改法完全一樣。

### 路線籤上的票價

每張籤除了路線號（`index.html` 另有公司標籤）外，右側多一格票價
（`.chip-fare`，用細分隔線與路線號分開）。票價取該路線的**全程收費**
（`fares[0]`，假日改用 `faresHoliday[0]`）。查不到就整格不顯示 ——
顯示 `$NaN`／`$0.0` 比不顯示更糟。

| 檔案 | 查價方式 |
|---|---|
| `index.html` | `chipFareText(routeId)`：`routeId` 本身就是 `fareDb` 的鍵，直接查表 |
| `gmb.html` | `gmbChipFareText(r)`：先用 `lookupGmbFareById(r.routeId)`（gtfsId），查不到才退回 `lookupGmbFare(路線號, 服務類型, 方向)` |

> **為何小巴一定要用 gtfsId 查價？** 同一個路線號會在不同地區各有一條線，票價也不同
> （路線「1」港島 $11.8、九龍 $10.9）。實測 770 個小巴 `gtfsId` 之中有 **113 個**
> 用「路線號 + 服務類型 + 方向」查會拿到**錯的票價**（例如路線 `12` 其中一條是 $13.4，
> 舊索引卻回 $5.7）。`buildGmbFareIndex()` 因此改成以 `gtfsId` 為主索引（`byId`），
> 舊的 `route+serviceType+bound` 只留作後備（`byKey`）。
> 小巴票價快取鍵同時由 `hk-gmb-fare-data-v3` 升到 **`v4`**，載入時清掉 v3。
>
> `loadGmbFareForCurrentRoute()`（選好方向後顯示的「全程收費」）也改用同一個精確查價。

### 車站名稱不顯示站號

票價檔的站名後面常掛著一組站號（「廣華醫院 (YT322)」）。UI 只顯示站名，
站號改用 `title` 提示保留。

```js
const STOP_CODE_RE = /\s*[（(]\s*[A-Za-z]{1,3}\d{1,4}\s*[)）]\s*$/;
function cleanStopName(name) { … }
```

**規則一定要限定結尾**：全港 15,267 個站之中 5,805 個帶站號，另有 445 個的括號
是名稱的一部分（「中環 (港澳碼頭)」「鰂魚涌 (海澤街)」），寬鬆的規則會把它們切壞
（實測站號出現在名稱中間的案例為 0 個）。

`cleanStopName()` 用在所有會產生站名的地方：`buildGeoIndex()` / `buildGmbGeoIndex()`、
`findStopsToDestination()` 的輸出、`fetchGmbRouteStops()`、`fetchKmbStop()`、
`fetchCitybusStop()`、`fetchNlbRouteStops()`；原始站名另存為 `nameFull` 供 `title` 使用。

### 相關常數

| 常數 | 檔案 | 值 | 說明 |
|---|---|---|---|
| `DEST_MAX_STOPS` | 兩者 | `5` | 回傳的車站數上限 |
| `DEST_RADII` | 兩者 | `[400, 800, 1500]` | 由近至遠放寬的半徑（米） |
| `GEO_RADII` | `index.html` | `[400, 800, 1500]` | `DEST_RADII` 的來源 |
| `GMB_GEO_RADII` | `gmb.html` | `[400, 800, 1500]` | `DEST_RADII` 的來源 |
| `PLACE_MAX_STOPS` | 兩者 | `400` | 名稱比對最多收集幾個相符車站 |
| `GEO_MAX_RESULTS` | `index.html` | `12` | 只供已停用的 `findRoutesByPlaceName()` 使用 |
| `GMB_GEO_MAX_RESULTS` | `gmb.html` | `12` | 只供已停用的 `findNearbyGmbRoutes()` 使用 |
| `GMB_REGIONS` | `gmb.html` | `[HKI 港島, KLN 九龍, NT 新界]` | 地區代號 → 顯示名／圖示；**陣列順序同時是彈窗的顯示順序**，也是 `GMB_REGION_IDS` 的來源 |
| `GMB_REGION_IDS` | `gmb.html` | `["HKI","KLN","NT"]` | 只用代號的地方（`resolveGmbRegion()`、`findRegionsForRoute()`） |

快取鍵升版（都是模組載入時主動 `removeItem` 舊鍵 —— 兩份加起來會超過
localStorage 上限，反而令新鍵寫不進去）：

| 鍵（舊 → 新） | 檔案 | 原因 |
|---|---|---|
| `hk-gmb-geo-stops-v2` → **`v3`** | `gmb.html` | `routeStopIdx` 多了 `pos`，格式改變 |
| `hk-bus-geo-stops-v2` → **`v3`** | `index.html` | 站名改為 `cleanStopName()` 清理過的版本 |
| `hk-gmb-fare-data-v3` → **`v4`** | `gmb.html` | 票價索引改以 `gtfsId` 為主鍵 |

> 票價快取鍵**這次沒有升版**，維持 `hk-bus-fare-data-v5`：新增的逐公司方向編碼
> （見「路線詳細資料彈窗」）只讓內容由 5,120,430 增至 5,121,526 字元，而
> `entryBoundFor()` 對舊格式（純 `"O"`／`"I"`）也讀得懂，舊快取照用即可 ——
> 升版會多佔一份空間，反而令新鍵寫不進去。

> **已移除**：兩頁舊的「附近路線」按鈕（`nearbySearch()` / `.gps-btn`、
> 桌機 `.gps-panel` 內的路線清單、手機 `.gps-overlay`）—— 該功能已併入「查詢」。
> `gmb.html` 另移除了 `gpsPickRoute()` / `closeGps()` / `clearGps()` 及
> `gpsLoading` / `gpsResults` / `gpsError` / `gpsOpen` / `gpsRows` 五個 ref。
> `findNearbyRoutes()`（`index.html`）、`findRoutesByPlaceName()`（`index.html`）
> 與 `findNearbyGmbRoutes()`（`gmb.html`）目前**沒有呼叫點**，
> 因本專案沒有版控而保留在檔案內（函式上方有標註），確定不需要時可整段刪除。
>
> `gmb.html` 另移除了側欄常駐的地區按鈕（`.region-buttons` 那一排）與
> `regionPickerVisible` ref、`onRouteInputFocus()` 處理函式；搜尋列的
> `@focus="onRouteInputFocus"` 也一併拿掉。地區改由
> `showRegionPicker` / `pickerRegions` / `pickerQuery` / `pickerRegionHint`
> 四個狀態驅動彈窗（見上方「輸入路線號之後」）。

---

## 模板綁定靜態檢查（`tools/check-bindings.py`）

**這是本專案最重要的回歸防護。** 原因：本專案用 Vue 3 的 **prod（生產）建置**，
而 prod 建置對「模板用到、但 `setup()` 沒有匯出」的識別字有致命行為：

> 它不會報錯、不會警告，`undefined` **靜默**代入模板。
> `v-if="(regionId || isSearching)"` → `(regionId || undefined)` → 永遠走錯分支。

實際踩過的坑：`rmb.html` 搜尋 `旺角` 時，因為 `isSearching` 忘了加進 `setup()` 的
`return {}`，結果**空狀態**蓋住了 33 條搜尋結果，而且 Console 全綠、零錯誤訊息。
只用肉眼看畫面或看 Console 都抓不到，必須靠靜態比對。

### 用法

```bash
python tools/check-bindings.py index.html gmb.html rmb.html
```

輸出：

```
index.html: OK (all template bindings exported)
gmb.html: OK (all template bindings exported)
rmb.html: OK (all template bindings exported)
```

有問題時會列出缺少的名稱並以 **exit code 1** 結束，可直接掛進 CI／pre-commit。

### 它檢查什麼

1. 抽出 `#app` 模板內所有 `{{ }}` 與 `v-if` / `v-else-if` / `v-for` / `v-model` /
   `:class` / `:key` / `:href` / `@click` / `@keyup.*` 的識別字
2. 減去 **`v-for` 迴圈變數**與**箭頭函式參數**（模板內合法，無需匯出）
3. 比對 `setup()` **`return { ... }`** 區塊的 key（取最長的那個 `return {}` 區塊）
4. 任何未匯出的綁定即報錯

已內建處理：字串／樣板字串、**regex 字面值**（否則 `/\n/g` 的 `g` 會被誤判為識別字）、
屬性存取（`a.b` 只取 `a`）、物件 key。

### ⚠️ 巢狀 `v-for` 的作用域（實作時踩過的坑）

第一版是「逐個屬性獨立分析」，結果 `index.html` / `gmb.html` / `rmb.html` 全部誤報
（`c`、`g`、`item`、`fav`、`i`、`r`、`s`… 共 8–12 個假警報）。

原因：`v-for` 變數的作用域包含**子孫元素**，例如

```html
<div v-for="g in placeGroups">
  <li v-for="item in g.rows" :key="'p-' + g.id + item.routeId">
```

`:key` 這條屬性本身不是 `v-for`，但它合法地引用了外層的 `g` 與 `item`。
所以檢查器必須**沿標籤順序走訪並維護作用域堆疊**（`TAG_RE` + 開合標籤），
遇到 `v-for` 才把迴圈變數推入；`<br>`、`<input>` 等 void 元素不可推入，
否則堆疊會與 `</div>` 對不上，作用域就會外洩。

修正後三份檔案都回報 `OK`，而刻意移除 `isMobile` 匯出時能正確報錯（exit 1）。

> ⚠️ 改完任何一個 HTML 的模板或 `setup()` 之後，**務必重跑這個檢查**。

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
  "gtfsId": { "gmb": "2002337" },
  "bound": { "gmb": "I" },
  "co": ["gmb"],
  "fares": ["11.8", "11.8", ...],
  "route": "1",
  "serviceType": 1
}
```

**關鍵**：不要用外部 key（那是 hkbus 內部格式），而是**從條目內部讀取欄位**。

`buildGmbFareIndex()` 產生**兩層**索引：

```javascript
byId[gtfsId]                                = rec;   // 精確：同一路線號在不同地區票價不同
byKey[`${routeCode}+${serviceType}+${boundGmb}`] = rec;   // 後備，只取第一次出現的
```

- `byId` 是主要索引。`gtfsId.gmb`（＝GMB API 的 `route_id`）才是精確身分：
  實測 770 個 `gtfsId` 中有 **113 個**用 `byKey` 查會拿到錯的票價
  （路線「1」港島 $11.8 / 九龍 $10.9；路線「12」有一條是 $13.4 而 `byKey` 回 $5.7）。
  同一個 `gtfsId` 的兩個方向（`O` / `I`）票價一致，已對整個檔案驗證過。
- `byKey` 只在拿不到 `gtfsId` 時使用。注意它會**碰撞**：1154 筆小巴條目只收斂成
  973 個 key，181 筆被覆蓋。
- 對外用 `lookupGmbFareById(routeId)`（精確）與 `lookupGmbFare(路線號, 服務類型, 方向)`
  （後備）兩個函式。

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

**檢查同一條線兩個方向的票價是否真的不同**（用來驗證「詳請」與側欄有沒有吃到方向）：

```javascript
(async () => {
  const j = await (await fetch("routeFareList.min.json")).json();
  console.table(
    Object.entries(j.routeList)
      .filter(([, e]) => String(e.route) === "1" && String(e.serviceType) === "1")
      .map(([k, e]) => ({
        key: k,
        bound: JSON.stringify(e.bound),
        全程: e.fares[0],
        逐站: e.fares.join(" "),
      }))
  );
})();
```

1 號線會看到兩列：`...CHUK YUEN ESTATE+STAR FERRY`（bound `{"kmb":"O"}`，
逐站 `6.7 ×16` 之後轉 `5.8`）與 `...STAR FERRY+CHUK YUEN ESTATE`
（bound `{"kmb":"I"}`，`6.7 ×8` 之後轉 `6.3`）。

**檢查紅巴資料是否載入**（在 `rmb.html` 的 Console）：

```javascript
(async () => {
  const j = await (await fetch("rmb-routes.json")).json();
  console.log("紅巴 JSON 頂層 key:", Object.keys(j).slice(0, 8));
})();
```

**檢查紅巴的模板綁定有沒有漏匯出**（在專案根目錄，不是瀏覽器）：

```bash
python tools/check-bindings.py index.html gmb.html rmb.html
```

### 常見錯誤

| 錯誤 | 原因 | 解決 |
|---|---|---|
| `Promise {<pending>}` 永遠不變 | 網路封鎖第三方 CDN | 改用本地 `routeFareList.min.json` |
| `HTTP 429` | GMB API 請求過於頻繁 | 等待 1-5 分鐘，或清除快取重試 |
| `HTTP 404` | URL 錯誤或檔案未上傳 | 檢查檔名大小寫，確認檔案在 repo 根目錄 |
| 票價顯示 $0.0 或空白 | 資料未載入或索引失敗 | 執行上述 Console 指令檢查 |
| 地圖不顯示 | 座標轉換失敗或快取舊資料 | 清除 localStorage，重新整理 |
| **`v-if` 走了錯的分支，但 Console 完全沒報錯** | **模板用了某個識別字，但 `setup()` 的 `return {}` 忘了匯出** | **跑 `python tools/check-bindings.py`；prod 建置不會有任何提示** |
| **回程票價與去程一模一樣** | **`lookupFareEntry()` 沒比對行車方向** | **已修（見「路線詳細資料彈窗」）；確認 `loadFare()` 有傳 `r.direction`** |
| 「詳請」彈窗的班次顯示「暫無班次資料」 | `bus-detail.json` 未上傳或未產生 | 跑 `python tools/build-bus-detail.py`，並確認檔案在 repo 根目錄 |

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

### Q5: 為什麼紅色小巴頁沒有實時到站？

紅巴沒有政府開放的實時到站 API，也沒有官方站點座標，因此無 ETA、無地圖、無 GPS 定位。
頁面改為「地區 → 路線 → 詳細資料」的目錄式瀏覽，唯一資料來源是 `rmb-routes.json`
（來自 16seats.net，只供個人非商業參考）。

### Q6: 為什麼紅色小巴的詳情在電腦上是內嵌、手機上才彈出？

這是刻意對齊 `gmb.html` 的操作習慣：窄螢幕空間有限，彈出面板能一次看完整份詳情；
寬螢幕則把詳情直接放在右欄，方便與路線清單左右對照，避免多一次開／關的點擊。
兩者共用**同一份 markup**，是純 CSS 切換（見「紅色小巴頁面架構」）。

### Q7: 為什麼巴士的「詳請」一律彈窗，紅巴卻是內嵌？

巴士頁刻意沿用 `gmb.html` 的「詳請」做法 —— **一律彈出**（`720px` 寬、
`var(--modal-max-h)` 高），因為兩頁的詳細資料都是彈窗呈現，操作習慣要一致。
紅巴（`rmb.html`）走另一套：寬螢幕放右欄內嵌、窄螢幕才彈出（見 Q6）。

### Q8: 我改了模板，畫面卻「靜靜地壞掉」，沒有任何錯誤訊息？

這幾乎肯定是**模板綁定漏了匯出**。本專案用 Vue 3 的 prod 建置，
模板用到但 `setup()` 未匯出的識別字會被靜默當成 `undefined`，
`v-if` 於是走錯分支（整個區塊消失或錯誤顯示），而 Console **不會有任何訊息**。

請執行：

```bash
python tools/check-bindings.py index.html gmb.html rmb.html
```

這次修正紅巴搜尋失效（空狀態蓋住 33 條結果）就是靠這個工具抓出來的。

### Q9: 我可以用在 iOS / Android 嗎？

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
| 紅巴分段收費（起訖站組合定價） | 低 | 高 |
| 最愛支援 GPS 快速選取 | 低 | 低 |

> 紅巴的基礎瀏覽（地區 → 路線 → 詳情）已完成；剩下的分段收費需要重新設計 UI
> 讓用戶選目的地站，與 GMB 的複雜度相近。

### 渡輪 API

新渡輪的即時 API 端點尚未確認。如需實作，請至 [data.gov.hk](https://data.gov.hk) 搜尋「新渡輪」，找到「下一航班預計抵達時間」資料集後，取得實際 API URL。

### 港鐵 API

相對簡單，端點為：

```
https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=<線路代碼>&sta=<車站代碼>
```

線路代碼如 `TWL`（荃灣線）、`KTL`（觀塘線），車站代碼如 `ETS`（尖沙咀）。

---

## Android APK（已實作）

APK 是一個**超薄 WebView 外殼**，本身不含任何網頁程式碼，只負責載入線上版本：

```
https://mattpenny.github.io/transport/
```

已完成的 APK 位於 **`apk/Ansum-Transport-v1.0.apk`**（2.2 MB，已簽署），
完整原始碼在 **`android/`**，建置與手勢說明見 **`android/README.md`**。

### 關鍵特性：使用者永不需重新安裝

因為 APK 沒有打包任何 HTML／CSS／JS（已驗證：APK 內完全沒有這類檔案），
所以**更新 App 只需要 `git push`**：

1. 修改網頁，`git push` 到 GitHub Pages
2. 使用者重開 App（或三指輕觸重新載入）即取得最新版
3. **不需要發布新的 APK**

技術上是用 `WebSettings.LOAD_NO_CACHE`（已在 APK bytecode 中驗證為 `const/4 v3, #int 2`）
強制每次載入都向伺服器重新驗證。

### 手勢操作

單指完全不攔截（地圖拖曳、捲動、點按全部照常），只有多指手勢會被攔截：

| 手勢 | 動作 |
|---|---|
| 兩指右滑 | 上一頁 |
| 兩指左滑 | 下一頁 |
| 兩指下滑 | 捲到最頂 |
| 兩指上滑 | 捲到最底 |
| 三指輕觸 | 重新載入（取得 GitHub Pages 最新版） |
| 四指輕觸 | 清除快取後重新載入 |

### ⚠️ 部署狀態提醒（2026-09-24 實測）

APK 載入的是**線上**版本，但 GitHub Pages 上的內容**落後於本機**。
以下為逐一探測 `https://mattpenny.github.io/transport/` 每個資產的實際結果：

| 路徑 | 線上狀態 |
|---|---|
| `/` | ✅ `200` |
| `/index.html` | ✅ `200` |
| `/gmb.html` | ✅ `200` |
| **`/rmb.html`** | ❌ **`404`** |
| `/bus.png` | ✅ `200` |
| **`/gmb.png`** | ❌ **`404`** |
| **`/rmb.png`** | ❌ **`404`** |

| 項目 | 線上 `transport/` | 本機 |
|---|---|---|
| `rmb.html`（紅色小巴整個模式） | **404 不存在** | 存在（49 KB） |
| `gmb.png`、`rmb.png`（圖示） | **404 不存在** | 存在 |
| 「可選擇其他交通工具」樣式 | 舊版（14px 灰色） | 新版（22px 品牌色） |
| 首頁連結 | `ferry.html`（不存在）、`gmb.html` | `gmb.html`、`rmb.html` |

**在把本機內容推上 GitHub 之前，APK 會載入到一個含有壞連結的舊版本，
而且點「紅色小巴」會直接 404。**

請先 push `index.html`、`gmb.html`、`rmb.html`，以及 `bus.png`、`gmb.png`、`rmb.png`
和相關 `.json` 資料檔。

> **注意：本機 `transport-main/` 資料夾目前不是 git repo**（沒有 `.git`，
> `git rev-parse` 回報 `not a git repository`），環境內亦未安裝 `gh` CLI。
> 因此**無法由工具直接 push**，需先在該資料夾 `git init` 並設定 remote，
> 或改用 GitHub 網頁介面上傳。

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

**最後更新**：2026 年 9 月 24 日
