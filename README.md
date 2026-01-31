# pdf_pipeline
A PDF to JSON transformation pipeline using Poppler and OpenAI API

Poppler-utils are required
`sudo apt install poppler-utils`

Example:

Get PDF page count
`pages=$(pdfinfo statement.pdf | grep -oP '^Pages:\s*\K\d+')`

Extract text from PDF, omitting the first and the last page
`texttopdf -f 2 -l $((pages - 1)) statement.pdf statement.txt`

Convert the raw text file into a JSON array
`node extract.ts statement.txt > statement.json`
