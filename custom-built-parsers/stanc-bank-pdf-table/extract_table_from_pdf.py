#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pdfplumber>=0.11",
#   "pandas>=2.2",
# ]
# ///
"""Extract the tables of one or more PDFs to CSV, merging tables that share a
header across pages. Writes `<stem>-<n>.csv` next to the first PDF.

Used by parser.py in this directory.
"""
import pdfplumber
import pandas as pd
import sys
import json
from pathlib import Path
import argparse

def log(msg):
    print(f"[LOG] {msg}")

def normalize_header(header_row):
    """Normalize header for comparison."""
    return [str(cell).strip().lower() if cell is not None else "" for cell in header_row]

def extract_tables(pdf_paths, output_prefix=None, filter_headers_norm=None):
    # Verify inputs
    pdf_paths = [Path(p) for p in pdf_paths]
    for p in pdf_paths:
        if not p.exists():
            log(f"Error: File {p} not found.")
            sys.exit(1)

    output_dir = pdf_paths[0].parent
    base_name = output_prefix or pdf_paths[0].stem

    buffer_df = None
    buffer_header = None
    table_index = 0

    for pdf_path in pdf_paths:
        log(f"Opening PDF: {pdf_path}")
        with pdfplumber.open(pdf_path) as pdf:
            log(f"  Total pages: {len(pdf.pages)}")

            for page_number, page in enumerate(pdf.pages, start=1):
                log(f"  Processing page {page_number}...")
                tables = page.extract_tables() or []
                log(f"    Found {len(tables)} table(s)")

                for t_index, table in enumerate(tables, start=1):
                    if not table or len(table) < 2:
                        log(f"    Table {t_index} empty or too short—skipping.")
                        continue

                    header = normalize_header(table[0])

                    # If user provided a filter, skip non-matching headers
                    if filter_headers_norm is not None and header != filter_headers_norm:
                        log(f"    Table {t_index} header does not match filter—skipping.")
                        continue

                    rows = table[1:]
                    df = pd.DataFrame(rows, columns=header)

                    # First buffer?
                    if buffer_df is None:
                        buffer_df = df
                        buffer_header = header
                        log(f"    Started buffer with headers: {header}")
                    # Same header → append
                    elif header == buffer_header:
                        buffer_df = pd.concat([buffer_df, df], ignore_index=True)
                        log(f"    Appended table {t_index}. Buffer now has {len(buffer_df)} rows.")
                    # Different header → flush & start new
                    else:
                        table_index += 1
                        out_file = output_dir / f"{base_name}-{table_index}.csv"
                        buffer_df.to_csv(out_file, index=False)
                        log(f"    Flushed buffer to: {out_file}")
                        buffer_df = df
                        buffer_header = header
                        log(f"    New buffer with headers: {header}")

    # Final flush
    if buffer_df is not None:
        table_index += 1
        out_file = output_dir / f"{base_name}-{table_index}.csv"
        buffer_df.to_csv(out_file, index=False)
        log(f"Saved final buffer to: {out_file}")

def main():
    parser = argparse.ArgumentParser(
        description="Extract (and merge) only those tables whose headers match a given JSON array."
    )
    parser.add_argument(
        "pdf_files", nargs="+",
        help="One or more PDF files (in order) to process."
    )
    parser.add_argument(
        "-o", "--output-prefix",
        help="Optional prefix for all output CSV files (default: stem of first PDF)."
    )
    parser.add_argument(
        "-f", "--filter-headers",
        help=(
            "JSON array of column names to match exactly (e.g. "
            "'[\"\", \"description\", \"transaction reference\", \"rewards\\nearned\", "
            "\"rewards type\", \"international\\namount\", \"\"]')."
        )
    )
    args = parser.parse_args()

    # Parse filter-headers if given
    filter_headers_norm = None
    if args.filter_headers:
        try:
            raw = args.filter_headers
            hdr_list = json.loads(raw)
            filter_headers_norm = normalize_header(hdr_list)
            log(f"Filtering for tables with headers: {filter_headers_norm}")
        except json.JSONDecodeError as e:
            log(f"Error parsing JSON for --filter-headers: {e}")
            sys.exit(1)

    extract_tables(
        pdf_paths=args.pdf_files,
        output_prefix=args.output_prefix,
        filter_headers_norm=filter_headers_norm
    )

if __name__ == "__main__":
    main()
