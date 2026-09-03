"""Shared request/error handling for all calls to OpenRouter's API.

Transcription (/verify), chat (/chat), and voice synthesis (/speak) all go
through OpenRouter under the same OPENROUTER_API_KEY — this is the one place
that maps transport failures and OpenRouter's HTTP error codes to
client-appropriate HTTPExceptions, so main.py and vyas.py don't each
reimplement the same 401/429/timeout handling.
"""

import httpx
from fastapi import HTTPException

_HTTP_TIMEOUT = httpx.Timeout(65.0, connect=10.0)


async def post(url: str, api_key: str, **kwargs) -> httpx.Response:
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            response = await client.post(url, headers=headers, **kwargs)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="OpenRouter request timed out.")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach OpenRouter: {exc}")

    if response.status_code == 401:
        raise HTTPException(status_code=502, detail="OpenRouter rejected the API key.")
    if response.status_code == 429:
        raise HTTPException(
            status_code=429, detail="OpenRouter rate limit exceeded, please retry shortly."
        )
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter request failed ({response.status_code}): {response.text[:300]}",
        )
    return response


def require_api_key() -> str:
    import os

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Server misconfiguration: OPENROUTER_API_KEY is not set.",
        )
    return api_key
