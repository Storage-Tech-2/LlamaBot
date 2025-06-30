"""
main.py – FastAPI wrapper around an Outlines-powered LLM
-------------------------------------------------------
Run locally:
    poetry install
    uvicorn main:app --reload      # or: python -m uvicorn main:app --reload
"""

from __future__ import annotations

import json as pyjson
from pathlib import Path
from threading import RLock
from typing import Dict

import llama_cpp
import outlines
from fastapi import FastAPI, HTTPException, Request
from outlines import Generator
from outlines.types import JsonSchema
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Configuration (constants only)
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
SCHEMA_DIR = BASE_DIR / "schemas"

SCHEMA_MAP: Dict[str, str] = {
    "extraction": "extraction.schema.json",
}

# ---------------------------------------------------------------------------
# Concurrency guard – single global lock
# ---------------------------------------------------------------------------

_MODEL_LOCK = RLock()

# ---------------------------------------------------------------------------
# Model helper (no background threads / lifespans / idle‑unload logic)
# ---------------------------------------------------------------------------

def _load_model(app: FastAPI):
    """Load the LLM once, re‑using the instance stored on `app.state`."""
    with _MODEL_LOCK:
        if getattr(app.state, "model", None) is None:
            print("⏳  Loading LLM …")
            llm = llama_cpp.Llama.from_pretrained(
                repo_id="NousResearch/Hermes-2-Pro-Llama-3-8B-GGUF",
                filename="Hermes-2-Pro-Llama-3-8B-Q4_K_M.gguf",
                tokenizer=llama_cpp.llama_tokenizer.LlamaHFTokenizer.from_pretrained(
                    "NousResearch/Hermes-2-Pro-Llama-3-8B"
                ),
                n_gpu_layers=-1,
                flash_attn=True,
                n_ctx=8192,
                verbose=False,
            )
            app.state.model = outlines.from_llamacpp(llm)
            print("✅  Model ready.")
        return app.state.model


# ---------------------------------------------------------------------------
# FastAPI app (no lifespan handler)
# ---------------------------------------------------------------------------

app = FastAPI(
    title="LLM JSON-Schema API",
    description="Expose an LLM that reliably returns JSON.",
    version="0.5.0",
)


# ---------------------------------------------------------------------------
# Pydantic request / response models
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    mode: str = Field(..., examples=["extraction"], description="Which schema / task to use.")
    input_text: str = Field(..., description="Raw text fed into the prompt.")


class GenerateResponse(BaseModel):
    result: dict


# ---------------------------------------------------------------------------
# /generate endpoint – stateless apart from the shared model instance
# ---------------------------------------------------------------------------

@app.post("/generate", response_model=GenerateResponse, status_code=200)
def generate(req: GenerateRequest, request: Request):
    mode = req.mode.lower()
    if mode not in SCHEMA_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown mode '{mode}'. Choose one of {list(SCHEMA_MAP)}.",
        )

    # Ensure the model is initialised
    model = _load_model(request.app)

    # Read the JSON schema freshly for every request
    schema_path = SCHEMA_DIR / SCHEMA_MAP[mode]
    if not schema_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Schema file '{schema_path.name}' not found.",
        )
    with open(schema_path, encoding="utf-8") as f:
        schema_str = f.read()

    # Build a *new* generator for this call only (no generator caching)
    generator = Generator(
        model,
        JsonSchema(schema=schema_str, whitespace_pattern=None),
    )

    prompt = (
        "<|im_start|>system\n"
        "You are a world-class AI assistant that extracts data from text in JSON "
        "format with a strict schema. Here is the schema you must follow:\n"
        "<schema>\n"
        f"{schema_str}\n"
        "</schema>\n"
        "<|im_end|>\n"
        "<|im_start|>user\n"
        f"{req.input_text}\n"
        "<|im_end|>\n"
        "<|im_start|>assistant"
    )

    try:
        result_str = generator(prompt, max_tokens=8000)
        output: dict = pyjson.loads(result_str)
    except Exception as exc:  # noqa: BLE001
        print(f"❌  Generation failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}") from exc

    return GenerateResponse(result=output)


# ---------------------------------------------------------------------------
# Lightweight health check
# ---------------------------------------------------------------------------

@app.get("/healthz")
def health():
    return {"status": "ok"}
