## LlamaBot: Automatic Archive Assistant
Helps manages submissions for discord based archives. The bot currently has the following features:

* Guided submissions process with interactive elements helps create consistent, standardized posts
* Local LLM writing assistant creates the initial post and aids with editing it
* Automatic image reprocessing and litematic info extraction
* Seperate Endorser and Editor roles direct what gets archived and what needs further review
* Github integration: Archives are backed up on a Github repository in a machine readable format
* Thank you points: Keeps track of when people say "thanks" to another and rewards helpers with a special role

## Choosing colors
http://storagetech2.org/debug/colorpicker/

## Python server autostart
The bot can now launch the Python FastAPI server automatically on startup.

- Default behavior: tries `uv run uvicorn main:app` from the `python/` folder, then falls back to `python3 -m uvicorn` / `python -m uvicorn`.
- Dependency install: runs before server start (`uv sync` if `uv` exists, otherwise `python3 -m pip install -e .` / `python -m pip install -e .`).
- Disable autostart: set `PYTHON_SERVER_DISABLE=true`.
- Disable dependency install: set `PYTHON_DEPS_DISABLE=true`.
- Override command: set `PYTHON_SERVER_CMD` (example: `PYTHON_SERVER_CMD="uv run uvicorn main:app --host 127.0.0.1 --port 8001"`).
- Optional host/port overrides (when not using `PYTHON_SERVER_CMD`): `PYTHON_SERVER_HOST`, `PYTHON_SERVER_PORT`.
