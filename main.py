"""Standalone demo launcher for the vyas package.

This is NOT the module itself — it's a thin FastAPI app that mounts
`vyas.router` and serves the demo frontend in static/, so the package can be
run and tested on its own (`uvicorn main:app --reload`) without needing a
parent app like Ved's backend. A parent app would instead do:

    from vyas import router as vyas_router
    app.include_router(vyas_router, prefix="/api/vyas")

This file calls `load_dotenv()` since it's the actual process entry point
for the standalone demo; the vyas package itself never calls it, so it
doesn't fight with a parent app's own env loading when mounted elsewhere.
"""

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from vyas import router as vyas_router

load_dotenv()

app = FastAPI(title="Vyas (standalone demo)")
app.include_router(vyas_router)

# Registered last so the API routes above always match first — this mount's
# prefix ("/") would otherwise catch every request before they're reached.
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
