import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getExtractProfile } from "./modules/extractProfiles.ts";

const execFileAsync = promisify(execFile);
// -raw/-layout output can run well past execFile's default 1MB buffer for
// a several-page statement.
const maxBuffer = 10 * 1024 * 1024;

/** pdfinfo/pdftotext failures carry the useful detail in stderr, not the stack */
const stderrOf = (e: unknown) =>
  (e instanceof Error && "stderr" in e ? String(e.stderr).trim() : null) || String(e);

if (process.argv.length < 3) {
  console.log("No filename argument provided!");
  process.exit(1);
}

const filename = process.argv[2];

try {
  await fs.access(filename);
} catch {
  console.error(`Error: Infile '${filename}' not found`);
  process.exit(1);
}

// Provider is whatever directory the PDF lives in (pdfs/nu/*.pdf -> nu),
// mirrored into text/ so providers never share an output path. It also
// picks the extraction profile (page range, password) below, decided
// before any text exists to detect a content format from.
const provider = path.basename(path.dirname(filename));
const outdir = path.join(process.cwd(), "text", provider);
await fs.mkdir(outdir, { recursive: true });
const outfile = path.basename(filename, ".pdf") + ".txt";

const profile = getExtractProfile(provider);
const password = profile.passwordEnv ? process.env[profile.passwordEnv] : undefined;
const passwordArgs = password ? ["-upw", password] : [];

let pages: number;
try {
  const { stdout } = await execFileAsync("pdfinfo", [...passwordArgs, filename]);
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error("No Pages: line in pdfinfo output");
  pages = Number.parseInt(match[1]);
} catch (e) {
  console.error(`Failed to read PDF info: ${filename}`);
  console.error(stderrOf(e));
  process.exit(1);
}

if (pages <= 2) {
  console.error(`Skipping ${filename}: expected more than 2 pages, found ${pages}`);
  process.exit(1);
}
const { first: firstPage, last: lastPage } = profile.pageRange(pages);

// Pick the pdftotext mode that keeps each table row on one line.
// New statements have "Página N de M" page headers; -raw keeps rows intact.
// Everything else (old Nu, BBVA) doesn't; -layout keeps rows intact.
let sample: string;
try {
  const { stdout } = await execFileAsync(
    "pdftotext",
    [...passwordArgs, "-f", String(firstPage), "-l", String(lastPage), "--", filename, "-"],
    { maxBuffer },
  );
  sample = stdout;
} catch (e) {
  console.error(`Failed to read PDF text: ${filename}`);
  console.error(stderrOf(e));
  process.exit(1);
}
const mode = /^Página \d+ de \d+/m.test(sample) ? "-raw" : "-layout";

console.log(`Converting pages ${firstPage} to ${lastPage} of ${filename} (${mode})`);

let extracted: string;
try {
  const { stdout } = await execFileAsync(
    "pdftotext",
    [...passwordArgs, mode, "-f", String(firstPage), "-l", String(lastPage), "--", filename, "-"],
    { maxBuffer },
  );
  extracted = stdout;
} catch (e) {
  console.error(`Failed to convert: ${filename}`);
  console.error(stderrOf(e));
  process.exit(1);
}

// Clear out form feed characters and blank lines. split()+filter() drops a
// trailing newline's empty last element, same as how `sed` preserves -raw's
// lack of one but reproduces -layout's — so restore it only if it was there.
const stripped = extracted.replaceAll("\f", "");
const cleaned =
  stripped
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n") + (stripped.endsWith("\n") ? "\n" : "");

const outfilePath = path.join(outdir, outfile);
try {
  await fs.writeFile(outfilePath, cleaned);
} catch (e) {
  throw new Error(`Write to ${outfilePath} failed.`, { cause: e });
}

console.log(`Generated ${provider}/${outfile} from PDF ${filename}`);
