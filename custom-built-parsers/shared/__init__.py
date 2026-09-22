"""Shared foundation for the deterministic statement parsers.

Each `<bank-slug>/parser.py` stays a standalone `uv run` script and imports
this package by name:

    from shared import abacus

dbu6 runs parsers with this directory's parent on PYTHONPATH, so the import
works for a bundled parser and for one in a user's project alike.
"""
