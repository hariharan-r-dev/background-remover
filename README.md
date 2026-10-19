# Clearcut — Image Background Remover

Clearcut is split into two independently deployable applications:

```text
background-remover/
├── frontend/   Next.js interface → deploy to Vercel
├── backend/    FastAPI + rembg API → deploy to Render
└── render.yaml Optional Render Blueprint
```

The frontend can perform click-to-select removal locally with Google MediaPipe. Connecting the backend additionally enables automatic background removal with `rembg`.

## Deployment roots

| Service | Root directory | Why |
| --- | --- | --- |
| Vercel | `frontend` | This directory contains the Next.js `package.json`, configuration, and `app` source. |
| Render | `backend` | This directory contains `requirements.txt` and the FastAPI `main.py` entrypoint. |

Do **not** configure Vercel's root as `app`. The `app` folder contains routes only; Vercel needs the parent `frontend` directory to install dependencies and build Next.js.

## Connect Vercel and Render

Assume these deployment URLs:

- Frontend: `https://your-site.vercel.app`
- Backend: `https://your-api.onrender.com`

### 1. Configure Render

Create a Python web service using:

- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health Check Path: `/health`

Add this Render environment variable:

```text
FRONTEND_ORIGINS=https://your-site.vercel.app
```

This tells CORS which website may call the API. Do not add a trailing slash. Multiple origins can be separated with commas.

After deployment, verify:

- `https://your-api.onrender.com/`
- `https://your-api.onrender.com/health`
- `https://your-api.onrender.com/docs`

### 2. Configure Vercel

Import this repository and set Root Directory to:

```text
frontend
```

Add this Vercel environment variable to Production, Preview, and Development:

```text
NEXT_PUBLIC_API_BASE_URL=https://your-api.onrender.com
```

This embeds the public backend address into the browser build. Redeploy the frontend after changing it.

### 3. Update Render after receiving the Vercel URL

If Vercel assigned a different production URL, update `FRONTEND_ORIGINS` in Render and redeploy the backend. The values must match exactly:

```text
Vercel NEXT_PUBLIC_API_BASE_URL → Render service URL
Render FRONTEND_ORIGINS        → Vercel website URL
```

## Local development

### Backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend

Create `frontend/.env.local`:

```text
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Then run:

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Features

- Browser-local click-to-select segmentation with Google MediaPipe
- Optional automatic background removal with FastAPI and `rembg`
- JPG, JPEG, PNG, WebP, and camera MPO support
- Transparent PNG output and ZIP batch download
- Maximum 20 files per batch and 25 MB per file
- Large-image memory protection and fallback processing

## Important hosting note

The Render configuration uses the lightweight `u2netp` model, a 1280 px processing limit, and reduced allocator arenas so it can fit more reliably within a 512 MiB instance. This trades some automatic-removal accuracy for lower memory use. Interactive MediaPipe selection remains the preferred mode for difficult images and works entirely in the frontend.

## Privacy

MediaPipe processing occurs in the visitor's browser. Backend uploads are processed in memory and are not intentionally persisted. No database is used.

## License

No license has been added yet. All rights are reserved by the repository owner unless a license file is provided.
