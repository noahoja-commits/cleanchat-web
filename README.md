# CleanChat Web

A dark-themed AI chat app that runs in the browser. Deploy on Vercel in one click.

## Deploy to Vercel

### 1. Get a HuggingFace API key (free)
Go to https://huggingface.co/settings/tokens → Create token (type: **Read**) → copy it.

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/cleanchat-web.git
git push -u origin main
```

### 3. Deploy on Vercel
1. Go to https://vercel.com/import
2. Import your GitHub repo
3. Add environment variable:
   - **Key:** `HF_API_KEY`
   - **Value:** `hf_your_token_here`
4. (Optional) Add `HF_MODEL` to change the model
5. Click **Deploy**

Done. Your chat app is live at `https://cleanchat-web.vercel.app`.

## Run locally
```bash
cp .env.local.example .env.local
# Edit .env.local with your HF_API_KEY
npm install
npm run dev
# Open http://localhost:3000
```

## Features
- Dark theme (matches the desktop CleanChat look)
- Code blocks with line numbers
- Markdown rendering (bold, inline code, code blocks)
- Streaming-like typing indicator
- Responsive — works on mobile
- No JavaScript sent to the client except the UI — API key stays server-side
- Uncensored by default (change the model to anything on HuggingFace)

## Customize
- **Model:** Set `HF_MODEL` env var (default: Orenguteng/Llama-3-8B-Lexi-Uncensored)
- **System prompt:** Edit the `SYSTEM_PROMPT` constant in `app/page.tsx`
- **Theme:** Edit the `styles` object in `app/page.tsx`
