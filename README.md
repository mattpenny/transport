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
7. [模板綁定靜態檢查](#模板綁定靜態檢查toolscheck-bindingspy)
8. [關鍵實作細節](#關鍵實作細節)
9. [除錯與測試](#除錯與測試)
10. [常見問題](#常見問題)
11. [未來擴充](#未來擴充)

---

## 功能總覽

| 功能 | 巴士 (`index.html`) | 專線小巴 (`gmb.html`) | 紅色小巴 (`rmb.html`) | 渡輪 (`ferry.html`) |
|---|:---:|:---:|:---:|:---:|
| 路線搜尋 | ✅ | ✅（按區域） | ✅（按地區＋關鍵字） | 🚧 |
| 方向選擇 | ✅ | ✅ | ✅（行車方向） | 🚧 |
| 站點列表 | ✅ | ✅ | ⚠️ 只列行車路線（`via` 文字） | 🚧 |
| 實時到站 (ETA) | ✅ 最近 3 班 | ✅ 最近 3 班 | ❌ 紅巴無官方 ETA | 🚧 |
| 全程票價 | ✅ | ✅ | ✅（收費表） | 🚧 |
| 分段收費 | ✅ | ❌ | ❌ | ❌ |
| 地圖顯示 | ✅ | ✅ | ❌ | 🚧 |
| GPS 自動定位最近站 | ✅ | ✅ | ❌ | 🚧 |
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
├── start-local.bat             ← 本機啟動器（Windows，雙擊即可）
├── tools/
│   ├── fetch-td-gmb.py         ← 由運輸署開放數據產生 gmb-detail.json
│   ├── fetch-16seats.ps1       ← 抓取 16seats.net 資料（紅色小巴目錄）
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

### Q7: 我改了模板，畫面卻「靜靜地壞掉」，沒有任何錯誤訊息？

這幾乎肯定是**模板綁定漏了匯出**。本專案用 Vue 3 的 prod 建置，
模板用到但 `setup()` 未匯出的識別字會被靜默當成 `undefined`，
`v-if` 於是走錯分支（整個區塊消失或錯誤顯示），而 Console **不會有任何訊息**。

請執行：

```bash
python tools/check-bindings.py index.html gmb.html rmb.html
```

這次修正紅巴搜尋失效（空狀態蓋住 33 條結果）就是靠這個工具抓出來的。

### Q8: 我可以用在 iOS / Android 嗎？

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
