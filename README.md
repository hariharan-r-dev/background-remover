# Image Background Remover

A local-first batch background remover using Next.js, FastAPI, Pillow, and `rembg`.
Images are processed by a model running on your own computer. There is no cloud API or database.

## Requirements
- Node.js 20.9+
- Python 3.11, 3.12, or 3.13
- Internet access for initial dependency/model downloads

## 1. Backend setup (Windows PowerShell)

Open PowerShell in this project folder:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

If PowerShell blocks activation, use:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

On the first successful request, `rembg` downloads its model weights. This requires internet access and can take time. Subsequent processing uses the local model cache.

## 2. Frontend setup

Open a second PowerShell terminal in the project root:

```powershell
npm install
npm run dev
```

Open http://localhost:3000.

## 3. Use it
1. Add or drag multiple JPG, PNG, or WEBP images.
2. Click **Remove backgrounds**.
3. Review successful transparent PNG previews.
4. Download individual images or click **Download all as ZIP**.

## API
- `GET http://127.0.0.1:8000/health`
- `POST http://127.0.0.1:8000/remove` with multipart form field `file`; returns a transparent PNG.

## Limits and safety
- API accepts one image per request; the UI queues batch requests sequentially to avoid exhausting RAM.
- Per-file maximum is 10 MB; the UI allows up to 20 files per batch.
- Files are processed in memory and are not saved by this app.
- Bind the backend to `127.0.0.1` for local-only use. Do not expose it to a public network without adding authentication, rate limits, and stronger resource limits.
- Model inference can be slow on CPU, especially for large images. Resize very large source images if necessary.
