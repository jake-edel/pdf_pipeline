# pdf_pipeline
A PDF to JSON transformation pipeline using Poppler and OpenAI API

Poppler-utils are required
`sudo apt install poppler-utils`

Example:
Extract text from PDF, omitting the first and the last page
Batch extract => `ls data/pdfs | ./extract_pdf_text.sh`
Single file extract => `./extract_pdf_text.sh statement.pdf`

Convert the raw text file into a JSON array
`node extract.ts statement.txt > statement.json`
