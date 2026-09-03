"""One-off script: generate Vyas's portrait via OpenRouter's image API and
save it into static/, replacing the placeholder SVG illustration.

Usage (from the mantra_verify/ directory, with a real key in .env):
    source venv/bin/activate
    python scripts/generate_vyas_portrait.py

Re-run any time to regenerate with a different prompt/model/seed.
"""

import base64
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images"
IMAGE_MODEL = "black-forest-labs/flux.2-pro"
OUTPUT_PATH = Path(__file__).parent.parent / "static" / "vyas-portrait.png"

PROMPT = (
    "A richly detailed digital painting of an ancient Indian sage named Vyas, "
    "seated in padmasana beneath the sprawling aerial roots of a large banyan "
    "tree. Very long, flowing white/grey hair past his shoulders and a long, "
    "thick white beard reaching his chest. Warm brown, weathered but serene "
    "skin. Forehead bears a white tripundra (three horizontal ash lines) with "
    "a small red bindi. Eyes are gentle, wise, luminous — conveying deep "
    "sanctity and calm — looking directly at the viewer. Flowing saffron/"
    "deep-orange monk's robes draped over one shoulder, multiple strands of "
    "dark brown rudraksha prayer beads. Right hand raised beside the shoulder "
    "in a teaching mudra (thumb and forefinger touching), left hand resting "
    "on the knee. Seated on a rolled log cushion atop a patterned orange-and-"
    "cream rug, smooth grey stones and a small brass pot nearby, a white bird "
    "in flight beside him. Soft warm light filtering through the canopy. Warm "
    "saffron/brown/cream palette. Painterly, realistic illustration style, "
    "portrait orientation, highly detailed, sacred and serene atmosphere."
)


def main():
    load_dotenv(Path(__file__).parent.parent / ".env")
    api_key = require_api_key()

    payload = {
        "model": IMAGE_MODEL,
        "prompt": PROMPT,
        "aspect_ratio": "3:4",
        "resolution": "2K",
        "output_format": "png",
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    print(f"Requesting image from {IMAGE_MODEL}...")
    response = httpx.post(OPENROUTER_IMAGES_URL, headers=headers, json=payload, timeout=120.0)
    response.raise_for_status()
    data = response.json()

    b64_image = data["data"][0]["b64_json"]
    OUTPUT_PATH.write_bytes(base64.b64decode(b64_image))
    cost = data.get("usage", {}).get("cost")
    print(f"Saved to {OUTPUT_PATH}" + (f" (cost: ${cost})" if cost is not None else ""))


if __name__ == "__main__":
    main()
