# Clearcut — Image Background Remover

Clearcut is a privacy-focused background-removal web app built with Next.js. It supports interactive subject selection in the browser with Google MediaPipe and an optional Python backend for automatic background removal with `rembg`.

## Features

- Click a person or object to isolate it from crowded images
- Browser-local processing with Google MediaPipe Interactive Segmenter
- Optional automatic removal through FastAPI and `rembg`
- Batch queue with original/result previews
- Individual transparent PNG downloads
- Download completed images as a ZIP archive
- JPG, JPEG, PNG, WebP, and camera MPO input support
- Up to 20 images per batch and 25 MB per file
- Responsive interface with drag-and-drop uploads

## Technology

- Next.js 15 and React 19
- TypeScript and Tailwind CSS
- Google MediaPipe Tasks Vision
- FastAPI, Pillow, and `rembg` for the optional backend

## Getting started

### Frontend

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To use interactive removal, upload an image, select **Pick subject**, and click the person or object in the original preview. The MediaPipe model is downloaded on first use and then runs in the browser.

### Optional automatic-removal backend

Requirements: Python 3.11–3.13.

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend with the backend URL configured:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:8000"
npm.cmd run dev
```

The backend downloads its segmentation model on first startup. It processes files in memory and does not save uploaded images.

## Production build

The frontend is configured as a static Next.js export:

```bash
npm run build
```

Deploy the generated `out` directory to any static hosting provider. Do not set `NEXT_PUBLIC_API_BASE_URL` unless a separately hosted FastAPI backend is available over HTTPS with suitable authentication, rate limiting, and CORS configuration.

## API

When the optional backend is running:

- `GET /health` — backend and model status
- `POST /remove` — multipart upload using the `file` field; returns a transparent PNG

## Privacy

Interactive MediaPipe processing happens in the visitor's browser. The optional backend runs locally by default. No database is used, and the application does not intentionally persist uploaded images.

## Limitations

- The initial MediaPipe or `rembg` model download requires internet access.
- Interactive selection is recommended for photos containing multiple people.
- Large images are processed at a bounded working resolution to reduce memory usage.
- Exact results can vary by image complexity, lighting, blur, and overlapping subjects.

## License

No license has been added yet. All rights are reserved by the repository owner unless a license file is provided.
