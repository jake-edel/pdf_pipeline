#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEXT_DIR="$SCRIPT_DIR/text"

convert_pdf() {
	local infile="$1"
	local base_infile="${infile##*/}"
	local outfile="${base_infile%.pdf}.txt"
	local pages first_page last_page sample mode

	pages=$(pdfinfo "$infile" | awk '/^Pages:/ { print $2 }') || {
		echo "Failed to read PDF info: $infile" >&2
		return 1
	}
	(( pages > 2 )) || {
		echo "Skipping $infile: expected more than 2 pages, found $pages" >&2
		return 1
	}
	first_page=3

	last_page=$((pages - 1))

	# Pick the pdftotext mode that keeps each table row on one line.
	# New statements have "Página N de M" page headers; -raw keeps rows intact.
	# Old statements don't; -layout keeps rows intact.
	sample=$(pdftotext -f $first_page -l $last_page -- "$infile" -) || {
		echo "Failed to read PDF text: $infile" >&2
		return 1
	}
	if grep -qE '^Página [0-9]+ de [0-9]+' <<< "$sample"; then
		mode="-raw"
	else
		mode="-layout"
	fi

	echo "Converting pages $first_page to $last_page of $infile ($mode)"

	# Extract text from PDF
	# Clear out form feed character
	# Clear out empty lines
	# Write out file
	# (explicit check: set -e is disabled inside a function used with ||)
	pdftotext $mode -f $first_page -l $last_page -- "$infile" - \
		| tr -d '\f' \
		| sed '/^[[:space:]]*$/d' \
		> "$TEXT_DIR/$outfile" || {
		echo "Failed to convert: $infile" >&2
		return 1
	}

	echo "Generated $outfile from PDF $infile"
	echo ""
}

if (( $# >= 1 ))
then
	# Single file operation
	if [[ ! -f "$1" ]]; then
		echo "Error: Infile '$1' not found" >&2
		exit 1
	fi

	convert_pdf "$1"
elif [[ ! -t 0 ]]
then
	# Bulk operation from a list of file paths on stdin, one per line
	failed=0
	while IFS= read -r infile; do
		[[ -n "$infile" ]] || continue
		convert_pdf "$infile" || failed=$((failed + 1))
	done

	if (( failed > 0 )); then
		echo "$failed file(s) failed" >&2
		exit 1
	fi
else
	echo "Usage: $0 <infile>, or pipe a list of files: ls dir/*.pdf | $0" >&2
	exit 1
fi
