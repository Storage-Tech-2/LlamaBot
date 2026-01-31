"""
main.py – FastAPI wrapper around an Outlines-powered LLM
-------------------------------------------------------
Run locally:
    poetry install
    uvicorn main:app --reload      # or: python -m uvicorn main:app --reload
"""

from __future__ import annotations
from sentence_transformers import SentenceTransformer  
from sentence_transformers.quantization import quantize_embeddings

import json as pyjson
import base64
import torch
from pathlib import Path
from threading import RLock
from typing import Dict

import llama_cpp
import outlines
from fastapi import FastAPI, HTTPException, Request
from outlines import Generator
from outlines.types import JsonSchema
from pydantic import BaseModel, Field
import gc

# ---------------------------------------------------------------------------
# Configuration (constants only)
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Concurrency guard – single global lock
# ---------------------------------------------------------------------------

_MODEL_LOCK = RLock()

# ---------------------------------------------------------------------------
# Model helper (no background threads / lifespans / idle‑unload logic)
# ---------------------------------------------------------------------------

def _load_model(app: FastAPI):
    """Load the LLM"""
    print("⏳  Loading LLM …")
    llm = llama_cpp.Llama.from_pretrained(
        repo_id="NousResearch/Hermes-3-Llama-3.1-8B-GGUF",
        filename="Hermes-3-Llama-3.1-8B.Q4_K_M.gguf",
        tokenizer=llama_cpp.llama_tokenizer.LlamaHFTokenizer.from_pretrained(
            "NousResearch/Hermes-3-Llama-3.1-8B"
        ),
        n_gpu_layers=-1,
        flash_attn=True,
        n_ctx=8192,
        verbose=False,
    )
    model = outlines.from_llamacpp(llm)
    print("✅  Model ready.")
    return model



def _load_document_model():
    """Load the document embedding model"""
    print("⏳  Loading document model …")
    model = SentenceTransformer("Snowflake/snowflake-arctic-embed-m-v1.5") 
    print("✅  Model ready.")
    return model

def _load_query_model():
    """Load the query embedding model"""
    print("⏳  Loading query model …")
    model = SentenceTransformer("MongoDB/mdbr-leaf-ir") 
    print("✅  Model ready.")
    return model

query_model_cached = _load_query_model()


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
    schema_text: str = Field(..., description="JSON schema to use for generation.")
    input_text: str = Field(..., description="Raw text fed into the prompt.")


class GenerateResponse(BaseModel):
    result: dict


class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., description="List of texts to embed.")
    model_type: str = Field(..., description="Type of embedding model to use (document or query).")

class EmbedResponse(BaseModel):
    embeddings: list[str]



# ---------------------------------------------------------------------------
# /generate endpoint – stateless apart from the shared model instance
# ---------------------------------------------------------------------------

@app.post("/generate", response_model=GenerateResponse, status_code=200)
def generate(req: GenerateRequest, request: Request):
    with _MODEL_LOCK:
        # Ensure the model is initialised
        model = _load_model(request.app)

        # Validate the schema
        try:
            schema_str = pyjson.dumps(pyjson.loads(req.schema_text), indent=2)
        except pyjson.JSONDecodeError as exc:
            print(f"❌  Invalid JSON schema: {exc}")
            raise HTTPException(status_code=400, detail=f"Invalid JSON schema: {exc}") from exc
        

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
            generator = None  # Clear the generator to free resources
            model = None  # Clear the model to free resources
            gc.collect()
        except Exception as exc:  # noqa: BLE001
            print(f"❌  Generation failed: {exc}")
            generator = None  # Clear the generator to free resources
            model = None  # Clear the model to free resources
            gc.collect()
            raise HTTPException(status_code=500, detail=f"Generation failed: {exc}") from exc

        return GenerateResponse(result=output)


@app.post("/embed", response_model=EmbedResponse, status_code=200)
def embed(req: EmbedRequest, request: Request):
    with _MODEL_LOCK:
        # Ensure the appropriate model is initialised
        if req.model_type == "document":
            model = _load_document_model()
        elif req.model_type == "query":
            model = query_model_cached
        else:
            raise HTTPException(status_code=400, detail=f"Invalid model_type: {req.model_type}")

        try:
            if req.model_type == "document":
                embeddings = model.encode(req.texts, truncate_dim=512)
            else:
                embeddings = model.encode(req.texts, truncate_dim=512, prompt_name="query")

            ranges = torch.tensor([[-0.3], [+0.3]]).expand(2, embeddings.shape[1]).cpu().numpy()
            quantized = quantize_embeddings(embeddings, "int8", ranges=ranges)
            # quantized = quantize_embeddings(embeddings,"binary")
            # convert to base64 strings
            quantized = [base64.b64encode(emb).decode('utf-8') for emb in quantized]
            
            model = None  # Clear the model to free resources
            gc.collect()
        except Exception as exc:  # noqa: BLE001
            print(f"❌  Embedding failed: {exc}")
            model = None  # Clear the model to free resources
            gc.collect()
            raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}") from exc

        return EmbedResponse(embeddings=quantized)
# Example curl command:
# curl -X POST "http://localhost:8000/embed" -H "Content-Type: application/json" -d '{"texts": ["example text"], "model_type": "document"}'

# ---------------------------------------------------------------------------
# Lightweight health check
# ---------------------------------------------------------------------------

@app.get("/healthz")
def health():
    return {"status": "ok"}
