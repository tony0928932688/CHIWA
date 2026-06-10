# CHIWA AI 專案交接包

這包是給另一台電腦或另一個 Codex 對話接手用的完整專案交接資料。

## 你在另一台電腦要怎麼用

1. 把整個 `CHIWA-handoff-package-20260529-100115.zip` 複製到另一台電腦。
2. 解壓縮到一個固定資料夾，例如：
   `C:\Users\你的使用者名稱\Documents\Codex\CHIWA-handoff-package-20260529-100115`
3. 在新的 Codex 對話中，直接告訴它：
   「請讀取這個交接包，依照 `README-START-HERE.md` 和 `docs/HANDOFF.md` 接手我的 CHIWA AI 網站專案。」
4. 如果 Codex 不能直接讀到你的本機資料夾，你可以把 zip 檔直接拖進對話框，或把解壓後的重要檔案提供給它。

## 這包裡有什麼

- `website/`：目前網站前台檔案，可直接部署到 GitHub Pages。
- `website/index.html`：正式首頁與學員工作台主要檔。
- `website/lazy-workflow-test.html`：懶人自動化工作流測試頁。
- `website/assets/`：網站圖片資產，包含首頁 VSL / 特色影片封面。
- `backend-source/supabase/`：Supabase Edge Functions 原始碼。
- `backend-source/cloudflare/`：Cloudflare Worker / R2 相關原始碼。
- `backend-source/scripts/`：輔助腳本。
- `database/`：Supabase SQL schema / security hardening 參考檔。
- `docs/`：接手說明、部署檢查清單、近期修改紀錄。
- `.env.example`：環境變數名稱範本，不含真正 API Key。

## 很重要

這包不含真正 API Key 或密鑰。另一台電腦要部署或呼叫後端時，需要登入你的 GitHub、Supabase、Cloudflare、RunningHub、Cartesia、Shotstack 等帳號，從平台後台或既有 Edge Function secrets 取得設定。

不要把真正 API Key 貼到公開 GitHub，也不要放進這個 zip。
