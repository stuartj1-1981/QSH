"""qsh.qsdb — DuckDB-backed local historian store (INSTRUCTION-505A).

Ships as source (Nuitka's ``--module`` rejects ``__init__.py``). Importing
this package does not import ``duckdb`` — that happens lazily inside
``QsdbStore`` (see ``qsh/qsdb/store.py``), so an install running the
InfluxDB backend with ``store.shadow: false`` never pays the cost of
loading it.
"""

from .store import QsdbStore

is_available = QsdbStore.is_available

__all__ = ["QsdbStore", "is_available"]
