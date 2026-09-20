#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" & pwd)"
TEXT_DIR="$SCRIPT_DIR/text"

infile="$1"
base_infile="${infile##*/}"
outfile="${base_infile%.pdf}.txt"

convert_pdf() {
	local pages first_page last_page

	pages=$(pdfinfo "$infile" | awk '/^Pages:/ { print $2 }') || {
		echo "Failed to read PDF info: $infile" >&2
		return 1
	}
	(( pages > 2 )) || return 1
	first_page=3

	last_page=$((pages - 1))

	echo "Converting pages $first_page to $last_page of $infile"

	# Extract text from PDF
	# Clear out form feed character
	# Clear out empty lines
	# Write out file
	pdftotext -f $first_page -l $last_page -- "$infile" - \
		| tr -d '\f' \
		| sed '/^[[:space:]]*$/d' \
		> "$TEXT_DIR/$outfile"

	echo "Generated $outfile from PDF $infile"
	echo ""
}

# Check whether file descriptor 
# is connected to a terminal
if [[ -t 0 ]]
then
	# Check that there is at least one argument passed
	if (( $# < 1 )); then
		echo "Usage: $0 <infile> or <infile> <outfile>"
		exit 1
	fi

	# Check that infile exists
	if [[ ! -f "$1" ]]; then
		echo "Error: Infile '$1' not found"
		exit 1
	fi

  convert_pdf "$infile" "$outfile"
else
	# Bulk operation from list of files
	while IFS= read -r infile; do
		outfile="${infile%.pdf}.txt"
		convert_pdf "$infile" "$outfile"
	done
fi

