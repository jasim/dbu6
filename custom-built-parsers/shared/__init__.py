"""Shared foundation for the deterministic statement parsers.

Each `<bank-slug>/parser.py` stays a standalone `uv run` script; it reaches
this package by putting `custom-built-parsers/` on `sys.path`:

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from shared import abacus
"""
