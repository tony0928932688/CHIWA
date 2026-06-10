CHIWA AI complete clean package

內容：
- index.html：正式網站與學員工作台完整前端檔
- lazy-workflow-test.html：懶人自動化工作流獨立測試頁
- privacy.html / terms.html：隱私權政策與服務條款
- assets/：網站 Logo 與 favicon
- backend-source/supabase/functions/：Supabase Edge Functions 原始碼
- backend-source/cloudflare/：Cloudflare Workers 原始碼與 wrangler 設定
- database/：Supabase schema / security SQL
- SECRET_MANIFEST.txt：所有需要設定的 Secret 名稱與位置

重要安全規則：
此交付包不包含真實 API Key。正式 API Key 必須放在 Supabase Secrets 或 Cloudflare Worker Secrets，不應寫進 GitHub、HTML、JS 或 ZIP 檔。

部署提醒：
1. 前端可上傳 index.html、lazy-workflow-test.html、privacy.html、terms.html、assets/、CNAME、.nojekyll 到 GitHub Pages。
2. Supabase Edge Functions 需用 Supabase CLI 或 Dashboard 部署 backend-source/supabase/functions。
3. Cloudflare Workers 需用 wrangler 部署 backend-source/cloudflare 內的 worker。
4. 部署後依 SECRET_MANIFEST.txt 補齊 Secrets。
