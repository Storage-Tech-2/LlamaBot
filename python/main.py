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
import llama_cpp
import outlines
from outlines.types import JsonSchema
from outlines import Generator

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Where your files live
BASE_DIR = Path(__file__).resolve().parent
SCHEMA_DIR = BASE_DIR / "schemas"          # ─┐

# MODEL_REPO = "microsoft/Phi-3-mini-4k-instruct-gguf"
# MODEL_FILE = "Phi-3-mini-4k-instruct-q4.gguf"   # placed in ~/.cache/gpt4all or local dir

# Map the external value of `mode` to the JSON schema filename
SCHEMA_MAP: Dict[str, str] = {
    "extraction": "extraction.schema.json"
}

# ---------------------------------------------------------------------------
# Load heavy assets once, at process start‑up
# ---------------------------------------------------------------------------

print("⏳ Loading LLM …")
model = outlines.models.llamacpp(
    repo_id="NousResearch/Hermes-2-Pro-Llama-3-8B-GGUF",
	filename="Hermes-2-Pro-Llama-3-8B-Q4_K_M.gguf",
    tokenizer=llama_cpp.llama_tokenizer.LlamaHFTokenizer.from_pretrained(
        "NousResearch/Hermes-2-Pro-Llama-3-8B"
    ),
    n_gpu_layers=-1,
    flash_attn=True,
    n_ctx=8192,
    verbose=False
)
# model = outlines.models.llamacpp(llm)

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
        ..., examples=["extraction"],
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
    schema_file = SCHEMA_MAP[mode]
    schema_path = SCHEMA_DIR / schema_file
    if not schema_path.exists():
        raise HTTPException(status_code=500,
                            detail=f"Schema file '{schema_file}' not found.")
    schema_str = ""
    with open(schema_path, "r", encoding="utf-8") as f:
        schema_str = f.read()
    prompt = f"""<|im_start|>system
You are a world class AI assistant that extracts data from text in JSON format with a strict schema. You will be given a prompt that contains a text input, and you will return a JSON object that matches the schema. Here's the json schema you must adhere to:
<schema>
{schema_str}
</schema>
<|im_end|>
<|im_start|>user
{req.input_text}
<|im_end|>
<|im_start|>assistant"""

    # 2️⃣ Call the model + constrained decoding
    try:
        result: dict = GENERATORS[mode](prompt)
    except Exception as exc:            # noqa: BLE001
        # log error
        print(f"❌ Generation failed: {exc}")
        raise HTTPException(status_code=500,
                            detail=f"Generation failed: {exc}") from exc

    return GenerateResponse(result=result)


# ---------------------------------------------------------------------------
# Optional: health check
# ---------------------------------------------------------------------------

@app.get("/healthz")
def health():
    return {"status": "ok"}
