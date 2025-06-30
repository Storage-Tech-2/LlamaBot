"""
main.py – FastAPI wrapper around an Outlines-powered LLM
-------------------------------------------------------

Run locally:
    poetry install
    uvicorn main:app --reload      # or: python -m uvicorn main:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from threading import Event, RLock, Thread
from typing import Dict, Optional
import gc
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import llama_cpp
import outlines
from outlines import Generator
from outlines.types import JsonSchema

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
SCHEMA_DIR = BASE_DIR / "schemas"

SCHEMA_MAP: Dict[str, str] = {
    "extraction": "extraction.schema.json",
}

# How long a model/generator can stay idle (in seconds) before being unloaded
IDLE_TIMEOUT = 10  # ⏱️  30-second inactivity window
CHECK_INTERVAL = 5  # How often the background thread checks (s)

# ---------------------------------------------------------------------------
# Lazy-loaded globals
# ---------------------------------------------------------------------------

_model: Optional[outlines.models.llamacpp] = None
_GENERATORS: Dict[str, Generator] = {}
_last_used: Optional[float] = None  # monotonic timestamp of last usage

# Synchronisation primitives
_state_lock = RLock()  # Re-entrant to avoid self-deadlock          # Guards all global state above
_stop_event = Event()         # Signals the background cleaner to exit


# ---------------------------------------------------------------------------
# Cache-lifecycle helpers
# ---------------------------------------------------------------------------

def _touch() -> None:
    """Record the current moment as the last-use timestamp. Must be called with _state_lock held."""
    global _last_used
    _last_used = time.monotonic()


def _cleanup_if_idle() -> None:
    """Unload the model & clear generators if they have been idle too long. Must be called with _state_lock held."""
    global _model, _GENERATORS, _last_used

    if _model is None or _last_used is None:
        return  # Nothing to do.

    if time.monotonic() - _last_used > IDLE_TIMEOUT:
        print("🧹  Unloading idle model and clearing generators …")
        _model = None
        _GENERATORS.clear()
        gc.collect()
        print("✅  Cache cleared.")


def _cleaner_loop() -> None:
    """Background thread that periodically triggers idle-cleanup until the app shuts down."""
    while not _stop_event.is_set():
        time.sleep(CHECK_INTERVAL)
        with _state_lock:
            _cleanup_if_idle()


# ---------------------------------------------------------------------------
# Model / generator management
# ---------------------------------------------------------------------------

def _load_model():
    """Instantiate the LLM the first time it's required—or after a cleanup."""
    global _model
    with _state_lock:
        _cleanup_if_idle()
        if _model is None:
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
            _model = outlines.from_llamacpp(llm)
            print("✅  Model ready.")
        _touch()
        return _model


def _get_generator(mode: str):
    """Return (and cache) a schema-specific generator. Raises 400 if mode is unknown."""
    if mode not in SCHEMA_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown mode '{mode}'. Choose one of {list(SCHEMA_MAP)}.",
        )

    with _state_lock:
        _cleanup_if_idle()
        _touch()
        if mode not in _GENERATORS:
            model = _load_model()
            schema_path = SCHEMA_DIR / SCHEMA_MAP[mode]
            if not schema_path.exists():
                raise HTTPException(
                    status_code=500,
                    detail=f"Schema file '{schema_path.name}' not found.",
                )
            with open(schema_path, encoding="utf-8") as f:
                schema_str = f.read()
            print(f"⏳  Compiling generator for mode '{mode}' …")
            _GENERATORS[mode] = Generator(
                model,
                JsonSchema(schema=schema_str, whitespace_pattern=None),
            )
            print(f"✅  Generator ready for mode '{mode}'.")
        return _GENERATORS[mode]


# ---------------------------------------------------------------------------
# FastAPI plumbing – with lifespan handler to manage background thread
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the cleaner thread when the app starts and stop it on shutdown."""
    cleaner = Thread(target=_cleaner_loop, daemon=True, name="model-cleaner")
    cleaner.start()
    try:
        yield
    finally:
        _stop_event.set()
        cleaner.join(timeout=1)


app = FastAPI(
    title="LLM JSON-Schema API",
    description="Expose an LLM that reliably returns JSON.",
    version="0.2.2",
    lifespan=lifespan,
)


class GenerateRequest(BaseModel):
    mode: str = Field(..., examples=["extraction"], description="Which schema / task to use.")
    input_text: str = Field(..., description="Raw text fed into the prompt.")


class GenerateResponse(BaseModel):
    result: str


@app.post("/generate", response_model=GenerateResponse, status_code=200)
def generate(req: GenerateRequest):
    mode = req.mode.lower()
    generator = _get_generator(mode)

    # Re-read schema (small) so prompt always matches on-disk file.
    schema_path = SCHEMA_DIR / SCHEMA_MAP[mode]
    with open(schema_path, encoding="utf-8") as f:
        schema_str = f.read()

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
        result: str = generator(prompt)
        with _state_lock:
            _touch()  # Mark usage after successful generation.
    except Exception as exc:  # noqa: BLE001
        print(f"❌  Generation failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}") from exc

    return GenerateResponse(result=result)


# ---------------------------------------------------------------------------
# Health check – stays lightweight
# ---------------------------------------------------------------------------

@app.get("/healthz")
def health():
    return {"status": "ok"}
