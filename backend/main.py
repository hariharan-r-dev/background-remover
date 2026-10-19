from io import BytesIO
import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from rembg import new_session, remove

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_PROCESSING_DIMENSION = 2048
# Some cameras store an ordinary JPEG preview in an MPO container. Treat it as
# a supported camera JPEG and normalize its first frame before inference.
ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}
ALLOWED_ORIGINS = os.getenv(
    "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",")
MODEL_NAME = os.getenv("REMBG_MODEL", "bria-rmbg")

app = FastAPI(title="Local Image Background Remover", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in ALLOWED_ORIGINS],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# BRIA RMBG is tuned for isolating the dominant foreground subject. This is a
# better default than a portrait model that may retain every person in a crowd.
# Reuse one session so it is loaded only once.
session = new_session(MODEL_NAME)


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "processing": "local"}


@app.post("/remove")
async def remove_background(file: UploadFile = File(...)):
    data = await file.read(MAX_FILE_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Maximum file size is 25 MB.")

    try:
        with Image.open(BytesIO(data)) as image:
            if image.format not in ALLOWED_FORMATS:
                raise HTTPException(status_code=415, detail="Unsupported image format.")
            image.verify()

        # Full-resolution edge refinement can exhaust memory on phone photos.
        # Bound the working image while preserving its aspect ratio so large
        # uploads still produce a useful result instead of failing outright.
        with Image.open(BytesIO(data)) as image:
            image.load()
            needs_normalizing = image.format == "MPO"
            if max(image.size) > MAX_PROCESSING_DIMENSION or needs_normalizing:
                image = ImageOps.exif_transpose(image)
                image.thumbnail(
                    (MAX_PROCESSING_DIMENSION, MAX_PROCESSING_DIMENSION),
                    Image.Resampling.LANCZOS,
                )
                working = BytesIO()
                image.convert("RGB").save(working, format="JPEG", quality=95)
                working_data = working.getvalue()
            else:
                working_data = data

        try:
            result = remove(
                working_data,
                session=session,
                # Remove colors bleeding into hair and soft edge pixels.
                decontaminate=True,
            )
        except Exception as refinement_error:
            # Edge cleanup is optional. If it cannot handle a difficult image,
            # return the model's basic cutout rather than failing the request.
            print(
                "Edge refinement failed; retrying basic cutout: "
                f"{type(refinement_error).__name__}: {refinement_error}"
            )
            result = remove(working_data, session=session)

        # Verify the generated result is a valid PNG before returning it.
        with Image.open(BytesIO(result)) as output:
            output.load()
            if output.format != "PNG":
                raise ValueError("Model did not return a PNG image.")

    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail="This file is not a valid supported image.")
    except Exception as exc:
        # Avoid returning internal paths or stack traces to the client.
        print(f"Background removal failed: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=500, detail="Background removal failed. Try another image.")

    return Response(
        content=result,
        media_type="image/png",
        headers={"Content-Disposition": 'inline; filename="background-removed.png"'},
    )
