"""Vyas: voice-verified mantra japa as a mountable FastAPI module.

Usage from a parent app (e.g. Ved's backend):

    from vyas import router as vyas_router
    app.include_router(vyas_router, prefix="/api/vyas")

`vyas` reads `OPENROUTER_API_KEY` from the environment at request time (not
at import time) — the parent app is responsible for having it set (its own
`.env` / `load_dotenv()`, or the process environment), same as any other
config the parent app already manages. Nothing in this package calls
`load_dotenv()` itself, to avoid silently overriding a parent app's own env
loading.

See README.md for the full endpoint list, the standalone demo, and the
product decisions behind the matching thresholds.
"""

from .routes import router

__all__ = ["router"]
