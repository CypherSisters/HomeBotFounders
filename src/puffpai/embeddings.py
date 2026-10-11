"""
PuffPAI Embedding Functions
===========================
ChromaDB-compatible embedding functions, selected by config.

Two backends:

``sentence_transformers`` (DEFAULT, do not change without a re-index)
    ChromaDB's ``SentenceTransformerEmbeddingFunction`` with
    ``all-MiniLM-L6-v2``. This is what **every existing collection in the
    ChromaDB store is embedded with**. Mixing embedding models inside one
    vector store does not error; it silently returns nonsense neighbours,
    so this stays the default until a deliberate, single full re-index.

``ollama``
    A GGUF embedder served by Ollama's ``/api/embed`` (default
    ``nomic-embed-text``). GPU-accelerated on the Orin and, more importantly,
    it removes ``sentence-transformers``/PyTorch from the runtime entirely.
    Ready to switch on; switching MUST be paired with a full re-index.

Switching (once):

    1. back up the ChromaDB directory
    2. ``ollama pull nomic-embed-text``
    3. set ``models.embedding_backend = "ollama"`` in
       ``config/puffpai_config.json``
    4. re-index **both** halves — these cover different collections and
       skipping either leaves part of the store in the old vector space::

           python scripts/reindex.py --force          # ZIM libraries
           python scripts/reindex.py --reembed --yes  # user_uploads,
                                                      # puffpai_vault,
                                                      # puffpai_knowledge

       Both exit non-zero if any collection is left incomplete — check the
       exit code, do not just read the summary line.

**Call sites must pass vectors, not text.** Not because chroma loses the
embedding function — it persists it and does apply it on a reopened handle
(only the ``_embedding_function`` *attribute* misreports as
``DefaultEmbeddingFunction``, which makes this easy to get backwards). The
problem is what existing collections persisted: collections created before
EF pinning carry an empty config, so chroma embeds them with its own ONNX
all-MiniLM-L6-v2 — and an explicit function can no longer be attached to them
(see `open_collection`). Passing ``embeddings=`` / ``query_embeddings=`` built
by `embed_documents` makes the *configured* function authoritative no matter
what any given collection persisted. That is the invariant the backend
switch depends on.

``sentence-transformers`` is NOT in ``requirements.txt`` — it drags PyTorch in,
which on Jetson must come from NVIDIA's wheel index. It is declared as the
``embeddings-legacy`` extra in ``setup.py``::

    pip install -e ".[embeddings-legacy]"
"""

from __future__ import annotations

import importlib.util
import logging
import threading
from typing import Any

import requests
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

from .config import DEFAULT_OLLAMA_URL, get_config

logger = logging.getLogger(__name__)

# The model every existing collection was built with. Changing this without a
# full re-index corrupts retrieval quality silently.
LEGACY_EMBEDDING_MODEL = "all-MiniLM-L6-v2"
DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text"

BACKEND_SENTENCE_TRANSFORMERS = "sentence_transformers"
BACKEND_OLLAMA = "ollama"


class OllamaEmbeddingFunction(EmbeddingFunction[Documents]):
    """Embed documents with a GGUF model served by Ollama's ``/api/embed``.

    ``/api/embed`` (not the older ``/api/embeddings``) takes a batch of
    strings and returns one vector per input, in order.
    """

    def __init__(self,
                 model_name: str = DEFAULT_OLLAMA_EMBEDDING_MODEL,
                 url: str | None = None,
                 timeout: int = 120) -> None:
        self._model_name = model_name
        self._url = (url or DEFAULT_OLLAMA_URL).rstrip("/")
        self._timeout = timeout

    def __call__(self, input: Documents) -> Embeddings:
        texts = [t for t in input]
        if not texts:
            # Chroma's own validation rejects an empty result, so returning []
            # here would only turn a caller bug into a confusing downstream
            # error. Say what actually happened instead.
            raise ValueError(
                "OllamaEmbeddingFunction called with no input documents")
        # Options are PER MODEL ROLE (model_options): an embedder gets
        # a context no larger than its own n_ctx_train and no num_predict.
        # Sending nothing lets ollama fall back to its server-wide default,
        # which on the appliance is the chat context (8192) and produces
        # "requested context size too large for model num_ctx=8192
        # n_ctx_train=2048" plus a needless runner re-plan.
        # keep_alive carries the configured resident pin so an embed call
        # cannot reset the embedder's residency to the ollama default.
        payload = {"model": self._model_name, "input": texts}
        try:
            from puffpai.inference import model_options as _mo
            payload.update(_mo.embedding_payload(self._model_name))
        except Exception:  # pragma: no cover - config/import failure only
            pass
        resp = requests.post(
            f"{self._url}/api/embed",
            json=payload,
            timeout=self._timeout,
        )
        resp.raise_for_status()
        vectors = (resp.json() or {}).get("embeddings")
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise RuntimeError(
                f"Ollama /api/embed returned {len(vectors) if isinstance(vectors, list) else 'no'} "
                f"vectors for {len(texts)} inputs (model={self._model_name!r}). "
                f"Is the model pulled? `ollama pull {self._model_name}`"
            )
        return vectors

    @staticmethod
    def name() -> str:
        return "puffpai_ollama"

    def get_config(self) -> dict[str, Any]:
        return {
            "model_name": self._model_name,
            "url": self._url,
            "timeout": self._timeout,
        }

    @staticmethod
    def build_from_config(config: dict[str, Any]) -> "OllamaEmbeddingFunction":
        return OllamaEmbeddingFunction(**config)

    def default_space(self) -> str:
        # New PuffPAI collections are pinned to cosine (see
        # ingestion.get_or_create_upload_collection).
        return "cosine"


# Register so Chroma can rebuild the function when re-opening a persisted
# collection that was created with it. Harmless (and idempotent-ish) if the
# name is already taken by a previous import in the same process.
try:  # pragma: no cover - registry behaviour is a chromadb detail
    from chromadb.utils.embedding_functions import register_embedding_function
    register_embedding_function(OllamaEmbeddingFunction)
except Exception as exc:  # noqa: BLE001 - never let registration break boot
    logger.debug("OllamaEmbeddingFunction not registered with chromadb: %s", exc)


_MISSING_ST_MESSAGE = (
    "The legacy embedding backend needs sentence-transformers "
    "(and PyTorch), which are not installed by default:\n"
    '    pip install -e ".[embeddings-legacy]"\n'
    "On Jetson, install torch from NVIDIA's wheel index first. "
    "Alternatively set models.embedding_backend = \"ollama\" in "
    "config/puffpai_config.json — but that requires a full re-index "
    "of the ChromaDB store."
)


def _sentence_transformer_ef(model_name: str):
    """Build the legacy sentence-transformers embedding function.

    The availability probe is ours, deliberately. ChromaDB 1.5.8 catches the
    ImportError internally and re-raises it as a ValueError whose message is
    just "pip install sentence_transformers" — which would bury the extra name
    and the Jetson wheel-index caveat. Checking find_spec() first means our
    message is the one the operator actually sees; the ValueError catch below
    is the belt-and-braces path for a package that is importable but broken.
    """
    if importlib.util.find_spec("sentence_transformers") is None:
        raise ImportError(_MISSING_ST_MESSAGE)
    try:
        from chromadb.utils.embedding_functions import (
            SentenceTransformerEmbeddingFunction)
        return SentenceTransformerEmbeddingFunction(model_name=model_name)
    except (ImportError, ValueError) as exc:
        raise ImportError(f"{_MISSING_ST_MESSAGE}\n(underlying error: {exc})") from exc


def get_embedding_function(cfg=None):
    """Return the ChromaDB embedding function selected by config.

    Reads ``models.embedding_backend``; defaults to the legacy
    sentence-transformers path so existing collections keep working.
    """
    cfg = cfg or get_config()
    backend = (getattr(cfg.models, "embedding_backend", "")
               or BACKEND_SENTENCE_TRANSFORMERS).strip().lower()

    if backend == BACKEND_OLLAMA:
        model = (getattr(cfg.models, "ollama_embedding_model", "")
                 or DEFAULT_OLLAMA_EMBEDDING_MODEL)
        logger.info("Embeddings: Ollama /api/embed (%s) at %s",
                    model, cfg.ollama.url)
        return OllamaEmbeddingFunction(model_name=model, url=cfg.ollama.url)

    if backend != BACKEND_SENTENCE_TRANSFORMERS:
        logger.warning(
            "Unknown models.embedding_backend=%r — falling back to %r",
            backend, BACKEND_SENTENCE_TRANSFORMERS)

    model = getattr(cfg.models, "embedding_model", "") or LEGACY_EMBEDDING_MODEL
    return _sentence_transformer_ef(model)


_shared_ef = None
_shared_ef_lock = threading.Lock()


def get_shared_embedding_function():
    """Process-wide cached embedding function.

    The sentence-transformers backend loads a model into RAM, so every caller
    must share one instance — on the Orin that matters, and it is also the
    only way the read side and the write side are guaranteed to be the same
    object rather than two equal-looking ones.
    """
    global _shared_ef
    if _shared_ef is None:
        with _shared_ef_lock:
            if _shared_ef is None:
                _shared_ef = get_embedding_function()
    return _shared_ef


def embed_documents(texts, embedding_function=None):
    """Embed `texts` with the configured function, returning raw vectors.

    Call sites that write to a collection should pass the result as
    ``embeddings=`` alongside ``documents=``. See `open_collection` for why
    leaving the choice of model up to the collection is not safe.
    """
    texts = list(texts)
    if not texts:
        return []
    ef = embedding_function or get_shared_embedding_function()
    return ef(texts)


def open_collection(client, name, embedding_function=None):
    """Return an existing collection with our embedding function attached
    *where chromadb allows it*.

    Two verified chromadb 1.5.8 behaviours make this necessary, and neither
    is documented:

    1. ``client.get_collection(name)`` DOES rehydrate and apply the persisted
       embedding function — but reports it wrongly. The returned handle's
       ``_embedding_function`` attribute reads ``DefaultEmbeddingFunction``
       even when ``documents=``/``query_texts=`` are in fact routed through
       the persisted one (verified by instrumenting a stub ``/api/embed``).
       So the attribute cannot be used to reason about, or assert on, which
       model a collection actually uses.

    2. What a collection persisted is therefore the thing that matters — and
       collections created before EF pinning persist an empty config (``{}``), which
       chroma treats as "default". They embed with chroma's ONNX
       all-MiniLM-L6-v2, and an explicit ``embedding_function=`` cannot be
       attached to them: it raises ``ValueError: ... Embedding function
       conflict``. Re-pinning them is only possible by re-creating them,
       which is exactly what the full re-index does.

    So this is best-effort: it attaches where it can and returns a plain
    handle where it cannot. **Callers that write or query must not depend on
    the handle's embedding function** — pass explicit ``embeddings=`` /
    ``query_embeddings=`` built by `embed_documents`. This helper exists to
    make the *new* collections correct and to keep the failure legible.
    """
    ef = embedding_function or get_shared_embedding_function()
    try:
        return client.get_collection(name=name, embedding_function=ef)
    except ValueError as exc:
        if "embedding function" not in str(exc).lower():
            raise
        logger.debug(
            "Collection %r has a default/absent persisted embedding function; "
            "using a plain handle. Writes MUST pass explicit embeddings=.",
            name)
        return client.get_collection(name=name)


def get_or_create_collection(client, name, embedding_function=None,
                             metadata=None):
    """`client.get_or_create_collection` that survives chroma's EF conflict.

    Pins a NEW collection to our embedding function. For one that already
    exists with a default/absent persisted function, chroma raises rather than
    re-attaching (see `open_collection`), so we fall back to the plain handle
    — same best-effort contract: writes still pass explicit ``embeddings=``.
    """
    ef = embedding_function or get_shared_embedding_function()
    kwargs: dict[str, Any] = {"embedding_function": ef}
    if metadata:
        kwargs["metadata"] = metadata
    try:
        return client.get_or_create_collection(name=name, **kwargs)
    except ValueError as exc:
        if "embedding function" not in str(exc).lower():
            raise
        logger.debug(
            "Collection %r rejected an explicit embedding function; "
            "falling back to a plain handle.", name)
        return client.get_or_create_collection(name=name)
