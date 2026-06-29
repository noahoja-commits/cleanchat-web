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
- Real-time **streaming** responses (with a Stop button — Esc)
- **Multiple conversations** — create, switch, rename (double-click), and delete; persisted in `localStorage`
- **Export** any chat to Markdown (`.md`) or JSON (`.json`)
- **Message actions** — copy any reply, copy individual code blocks, or regenerate the last response
- Markdown rendering — headings, bold/italic, lists, task lists, blockquotes, links, and code blocks with line numbers
- Dark theme, responsive layout, keyboard shortcuts (Ctrl/⌘+Enter send · Esc stop · Ctrl/⌘+Shift+N new · `/` focus)
- Server-side API key — the HuggingFace token never reaches the browser
- Per-IP rate limiting and request validation on the API routes

## Customize
- **Model:** Set `HF_MODEL` env var (default: `meta-llama/Llama-3.1-8B-Instruct`)
- **System prompt:** Edit the `SYSTEM_PROMPT` constant in `app/page.tsx`
- **Theme:** Edit the `styles` object in `app/page.tsx`
