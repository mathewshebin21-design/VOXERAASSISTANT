import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import get_settings
from .db import SessionLocal
from .logging_setup import configure_logging, request_id_var
from .routers import agents, auth, business, live, orgs, records, voice

log = logging.getLogger("voxera.api")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging()
    app = FastAPI(
        title="VOXERA API",
        version="0.1.0",
        description="Multi-tenant API for the VOXERA AI receptionist platform (Phase 2 foundation).",
        docs_url="/docs" if settings.env != "production" else None,
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id", "")[:64] or uuid.uuid4().hex
        token = request_id_var.set(rid)
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("unhandled error", extra={"method": request.method, "path": request.url.path})
            response = JSONResponse({"detail": "Internal server error", "request_id": rid}, status_code=500)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        if settings.env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        log.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - start) * 1000, 1),
            },
        )
        request_id_var.reset(token)
        return response

    @app.get("/healthz", tags=["health"])
    def healthz() -> dict:
        return {"status": "ok"}

    @app.get("/readyz", tags=["health"])
    def readyz() -> JSONResponse:
        try:
            with SessionLocal() as s:
                s.execute(text("SELECT 1"))
            return JSONResponse({"status": "ready"})
        except Exception:
            log.exception("readiness check failed")
            return JSONResponse({"status": "unavailable"}, status_code=503)

    for r in (auth.router, orgs.router, business.router, agents.router, records.router, voice.router, live.router):
        app.include_router(r)
    return app


app = create_app()
