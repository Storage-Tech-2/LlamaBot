"""
main.py - FastAPI wrapper around an Outlines-powered LLM
--------------------------------------------------------

Run locally:
    poetry install
    uvicorn main:app --reload  # or: python -m uvicorn main:app --reload
"""

import json
import os
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import outlines
from outlines import Template

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Where your files live
BASE_DIR = Path(__file__).resolve().parent
SCHEMA_DIR = BASE_DIR / "schemas"          # ─┐
PROMPT_TEMPLATE_PATH = BASE_DIR / "prompt.txt"  # ─┘ adjust as needed

MODEL_REPO = "microsoft/Phi-3-mini-4k-instruct-gguf"
MODEL_FILE = "Phi-3-mini-4k-instruct-q4.gguf"   # placed in ~/.cache/gpt4all or local dir

# Map the external value of `mode` to the JSON schema filename
SCHEMA_MAP: Dict[str, str] = {
    "extraction": "extraction.schema.json"
}

# ---------------------------------------------------------------------------
# Load heavy assets once, at process start‑up
# ---------------------------------------------------------------------------

print("⏳ Loading LLM …")
model = outlines.models.llamacpp(MODEL_REPO, MODEL_FILE)

print("⏳ Loading prompt template …")
PROMPT_TEMPLATE = Template.from_file(PROMPT_TEMPLATE_PATH)

print("⏳ Compiling schema-specific generators …")
GENERATORS: Dict[str, outlines.generate] = {}
for mode, fname in SCHEMA_MAP.items():
    schema_path = SCHEMA_DIR / fname
    with open(schema_path, "r", encoding="utf-8") as f:
        schema_str = f.read()
    GENERATORS[mode] = outlines.generate.json(model, schema_str)

print("✅ Startup complete.")

# ---------------------------------------------------------------------------
# FastAPI plumbing
# ---------------------------------------------------------------------------

app = FastAPI(title="LLM JSON-Schema API",
              description="Expose an LLM that reliably returns JSON.",
              version="0.1.0")


class GenerateRequest(BaseModel):
    mode: str = Field(
        ..., examples=["extraction", "modification"],
        description="Which schema / task to use.",
    )
    input_text: str = Field(..., description="Raw text fed into the prompt.")


class GenerateResponse(BaseModel):
    result: dict


@app.post("/generate", response_model=GenerateResponse, status_code=200)
def generate(req: GenerateRequest):
    mode = req.mode.lower()
    if mode not in GENERATORS:
        raise HTTPException(status_code=400,
                            detail=f"Unknown mode '{req.mode}'. "
                                   f"Choose one of {list(GENERATORS)}.")

    # 1️⃣ Build the concrete prompt
    prompt = PROMPT_TEMPLATE(input=req.input_text)

    # 2️⃣ Call the model + constrained decoding
    try:
        result: dict = GENERATORS[mode](prompt)
    except Exception as exc:            # noqa: BLE001
        raise HTTPException(status_code=500,
                            detail=f"Generation failed: {exc}") from exc

    return GenerateResponse(result=result)


# ---------------------------------------------------------------------------
# Optional: health check
# ---------------------------------------------------------------------------

@app.get("/healthz")
def health():
    return {"status": "ok"}
