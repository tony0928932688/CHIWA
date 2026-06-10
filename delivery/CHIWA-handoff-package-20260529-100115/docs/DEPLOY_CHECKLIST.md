# 部署檢查清單

## 靜態網站部署前

- 確認 `website/index.html` 可以正常開啟。
- 確認 `website/assets/` 內圖片存在。
- 確認首頁 VSL 封面顯示：
  - `assets/home-vsl-cover.jpg`
  - `assets/home-feature-cover-left.jpg`
  - `assets/home-feature-cover-right.jpg`
- 確認 `lazy-workflow-test.html` 仍為獨立測試頁，不影響正式工作台。
- 搜尋前端檔案，確認沒有真實 API Key。

## GitHub Pages 部署

- Repository：`tony0928932688/CHIWA`
- Branch：`gh-pages`
- 將 `website/` 內容放到 branch 根目錄。
- 推送後等待 GitHub Pages / CDN 更新。
- 用 cache busting URL 驗證，例如：
  `https://chiwaai.com/?check=時間戳`

## 正式站功能檢查

- 首頁可載入。
- VSL 影片可播放。
- 特色影片可播放。
- 預約諮詢按鈕可開啟 Google Calendar。
- LINE 浮動按鈕不顯示、不可點擊。
- Google 登入可進入學員工作台。
- 左下角 AI / 語音 / 影像額度顯示正確。
- 語音克隆可以生成並保存紀錄。
- 形象克隆可以上傳影片和音檔。
- 形象克隆生成結果可下載、可刪除。
- 課程面板影片可播放。

## 後端功能檢查

- Supabase Auth 登入正常。
- Supabase tables / RLS 沒有被意外放寬。
- Edge Functions secrets 均在平台後台，不在 repo。
- Cloudflare Worker 可匯入 / 下載 R2 檔案。
- Shotstack 渲染仍在測試頁階段，正式前需完整跑通。
