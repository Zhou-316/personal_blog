from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from app.api.routes import UPLOADS_DIR, router
from app.api.music import init_music_sessions, router as music_router
from app.db.database import init_db

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


def get_cors_origins() -> list[str]:
    origins = os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in origins.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    init_music_sessions()
    yield


app = FastAPI(title="Moss Letters Blog API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(music_router)


class UploadedImages(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["X-Content-Type-Options"] = "nosniff"
        # SVGs may be displayed as images, but must not execute scripts on navigation.
        response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
        return response


app.mount("/uploads", UploadedImages(directory=str(UPLOADS_DIR)), name="uploads")
