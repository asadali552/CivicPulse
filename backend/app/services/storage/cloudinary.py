from __future__ import annotations

import asyncio
from io import BytesIO
import logging
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings, upload_directory

logger = logging.getLogger(__name__)
IMAGE_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
}
SAFE_SUFFIX = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}


async def store_upload(file: UploadFile | None) -> str | None:
    if file is None:
        return None

    if file.content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, WebP, and GIF images are supported")
    content = await file.read()
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Image exceeds the {settings.max_upload_mb} MB upload limit")
    signatures = IMAGE_SIGNATURES[file.content_type]
    valid_signature = any(content.startswith(signature) for signature in signatures)
    if file.content_type == "image/webp":
        valid_signature = valid_signature and len(content) >= 12 and content[8:12] == b"WEBP"
    if not valid_signature:
        raise HTTPException(status_code=415, detail="File content does not match its declared image type")

    # Fully decode and re-encode every upload. This rejects corrupt/polyglot
    # files, removes EXIF/GPS metadata, normalizes orientation, and prevents
    # browser delivery of attacker-controlled trailing bytes.
    try:
        Image.MAX_IMAGE_PIXELS = settings.max_image_megapixels * 1_000_000
        with Image.open(BytesIO(content)) as source:
            source.verify()
        with Image.open(BytesIO(content)) as source:
            if source.width * source.height > settings.max_image_megapixels * 1_000_000:
                raise HTTPException(status_code=413, detail="Image dimensions are too large")
            image = ImageOps.exif_transpose(source)
            output = BytesIO()
            if file.content_type == "image/png":
                image.save(output, format="PNG", optimize=True)
            elif file.content_type == "image/webp":
                image.convert("RGB").save(output, format="WEBP", quality=88, method=6)
            else:
                # Animated GIF evidence is intentionally flattened to a safe
                # still JPEG; evidence workflows only require one clear frame.
                image.convert("RGB").save(output, format="JPEG", quality=90, optimize=True)
                file.content_type = "image/jpeg"
            content = output.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=415, detail="Image is corrupt or unsafe to process") from exc

    if settings.cloudinary_cloud_name and settings.cloudinary_api_key and settings.cloudinary_api_secret:
        import cloudinary
        import cloudinary.uploader

        cloudinary.config(
            cloud_name=settings.cloudinary_cloud_name,
            api_key=settings.cloudinary_api_key,
            api_secret=settings.cloudinary_api_secret,
            secure=True,
        )
        try:
            result = await asyncio.wait_for(asyncio.to_thread(
                cloudinary.uploader.upload,
                content,
                folder="civicpulse/evidence",
                resource_type="image",
                use_filename=False,
                unique_filename=True,
                overwrite=False,
            ), timeout=30)
            return result["secure_url"]
        except Exception as exc:
            logger.exception("Cloudinary upload failed; preserving evidence in local fallback: %s", type(exc).__name__)

    upload_root = upload_directory()
    upload_root.mkdir(parents=True, exist_ok=True)
    suffix = SAFE_SUFFIX[file.content_type]
    file_name = f"{uuid4().hex}{suffix}"
    destination = upload_root / file_name
    destination.write_bytes(content)
    return f"/uploads/{file_name}"
