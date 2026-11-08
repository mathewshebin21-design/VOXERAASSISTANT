import logging
import os
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from . import deploy_env, rc1_preview
from .config import get_settings
from .db import SessionLocal
from .logging_setup import configure_logging, request_id_var
from .routers import agents, auth, business, calls, design, desk, languages, live, orgs, records, voice

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

    # Refuse to serve from a database that belongs to another environment (app/deploy_env.py).
    guard = {"ok": deploy_env.expected() is None, "checked": 0.0, "why": None}

    def database_mismatch() -> str | None:
        if guard["ok"]:
            return None
        if time.monotonic() - guard["checked"] < 30:
            return guard["why"]
        try:
            with SessionLocal() as s:
                why = deploy_env.mismatch(s.connection())
        except Exception:
            log.exception("database environment check failed")
            why = "the database environment could not be checked"
        guard.update(ok=why is None, checked=time.monotonic(), why=why)
        if why:
            log.error("refusing requests", extra={"reason": why})
        return why

    @app.middleware("http")
    async def environment_guard(request: Request, call_next):
        if request.url.path != "/healthz" and not guard["ok"] and (why := await run_in_threadpool(database_mismatch)):
            return JSONResponse(
                {"detail": "This deployment is not connected to its own environment's database.", "reason": why},
                status_code=503,
            )
        return await call_next(request)

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
        # The deployed commit (public in the repo anyway) lets deploy checks wait for the right build.
        return {"status": "ok", "commit": os.environ.get("VERCEL_GIT_COMMIT_SHA", "")[:7] or None}

    @app.get("/readyz", tags=["health"])
    def readyz() -> JSONResponse:
        try:
            with SessionLocal() as s:
                s.execute(text("SELECT 1"))
            return JSONResponse({"status": "ready"})
        except Exception:
            log.exception("readiness check failed")
            return JSONResponse({"status": "unavailable"}, status_code=503)

    @app.get("/staging-identity", include_in_schema=False)
    def staging_identity() -> JSONResponse:
        if os.getenv("VERCEL_ENV") != "preview" or os.getenv("VERCEL_GIT_COMMIT_REF") != "staging":
            return JSONResponse({}, status_code=404)
        with SessionLocal() as session:
            # Read the marker from the actual runtime connection on every probe.
            if deploy_env.claimed(session.connection()) != "staging":
                return JSONResponse({}, status_code=503)
        return JSONResponse({"commit": os.getenv("VERCEL_GIT_COMMIT_SHA"), "environment": "staging"})

    @app.get("/rc1-identity", include_in_schema=False)
    def rc1_identity() -> JSONResponse:
        """Read-only isolation evidence for the RC-1 Preview, from the live runtime connection.

        Answers only on the RC-1 Preview profile. Reports booleans, the schema revision and the
        commit, never a host, user name or credential.
        """
        try:
            if not rc1_preview.active():
                return JSONResponse({}, status_code=404)
        except ValueError:
            return JSONResponse({}, status_code=404)
        with SessionLocal() as session:
            c = session.connection()
            role = c.execute(
                text(
                    "SELECT current_user = 'voxera_app', rolsuper, rolbypassrls, current_database() = 'neondb' "
                    "FROM pg_roles WHERE rolname = current_user"
                )
            ).one()
            environment = deploy_env.claimed(c)
            readable = c.execute(
                text(
                    "SELECT to_regclass('public.alembic_version') IS NOT NULL "
                    "AND has_table_privilege('public.alembic_version', 'SELECT')"
                )
            ).scalar()
            schema = c.execute(text("SELECT version_num FROM alembic_version")).scalar() if readable else None
        return JSONResponse(
            {
                "profile": "rc1-validation",
                "commit": os.getenv("VERCEL_GIT_COMMIT_SHA"),
                "environment": environment,
                "schema": schema,
                "runtime_role": bool(role[0]),
                "superuser": bool(role[1]),
                "bypass_rls": bool(role[2]),
                "dedicated_database": bool(role[3]),
            }
        )

    for r in (
        auth.router,
        orgs.router,
        business.router,
        agents.router,
        records.router,
        voice.router,
        live.router,
        desk.router,
        design.router,
        calls.router,
        languages.router,
        live.worker_router,
    ):
        app.include_router(r)
    return app


app = create_app()
