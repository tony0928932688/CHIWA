# CHIWA AI 專案交接說明

## 目前正式環境

- 正式網站：https://chiwaai.com
- GitHub Repository：`tony0928932688/CHIWA`
- GitHub Pages branch：`gh-pages`
- 主要前台檔案：`website/index.html`
- 懶人自動化測試頁：`website/lazy-workflow-test.html`
- Supabase project ref：`nsauscojruqjcprvsfsn`

## 目前網站重點功能

- 首頁與 VSL 銷講影片。
- 首頁特色影片區。
- Google 登入學員工作台。
- 帳號定位。
- 選題生成、口播文案、行銷文案、文案合規。
- 語音克隆與語音生成紀錄。
- 形象克隆、暫存影片庫、下載與刪除。
- 課程面板與管理員後台。
- 懶人自動化工作流測試頁：選題、口播文案、語音試聽、形象克隆、字幕與成片渲染測試。
- GTM / GA4 / TikTok 廣告流量追蹤事件。

## 最近已完成的重要改動

- 首頁文案已調整成較安全的 TikTok 廣告語意，移除絕對化和誇大聲稱。
- LINE 浮動按鈕已在前台隱藏且不可點擊。
- 預約諮詢連結導向 Google Calendar。
- 首頁 VSL 和特色影片封面支援固定圖片：
  - `website/assets/home-vsl-cover.jpg`
  - `website/assets/home-feature-cover-left.jpg`
  - `website/assets/home-feature-cover-right.jpg`
- 這三張封面已放入本交接包。

## 後端與服務

- Supabase Edge Functions 原始碼在 `backend-source/supabase/functions/`。
- Cloudflare Worker / R2 相關原始碼在 `backend-source/cloudflare/`。
- SQL 參考檔在 `database/`。
- 真正 secrets 應在 Supabase / Cloudflare 平台後台設定，不應寫入前端或 GitHub。

## 另一台電腦接手方式

1. 解壓縮本交接包。
2. 用 Codex 或編輯器打開交接包資料夾。
3. 若要只修改靜態網站，可先改 `website/` 裡的檔案。
4. 若要部署正式站，將 `website/` 內容同步到 GitHub `gh-pages` branch 根目錄。
5. 若要修改 Supabase Edge Functions，先登入 Supabase CLI 或在 Supabase Dashboard 內更新相同 function。
6. 若要修改 Cloudflare Worker / R2，先登入 Cloudflare 帳號並確認 Worker / R2 bucket 綁定。

## 不要做的事

- 不要把 `.env` 或任何真實 API Key commit 到 GitHub。
- 不要把 Supabase service role key 放進前端 `index.html`。
- 不要修改已上線的扣點邏輯前，先在測試帳號驗證。
- 不要把 `lazy-workflow-test.html` 的測試功能合併到正式工作台，除非流程已完整跑通。
