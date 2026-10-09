export type ExtractProfile = {
  /** Page range to run pdftotext over, given the PDF's total page count */
  pageRange: (totalPages: number) => { first: number; last: number };
  /** Env var holding a PDF password, for providers whose files can be encrypted */
  passwordEnv?: string;
};

/** Whole-document, no-password extraction, for a provider with nothing registered below */
const defaultProfile: ExtractProfile = {
  pageRange: (pages) => ({ first: 1, last: pages }),
};

const profiles: Record<string, ExtractProfile> = {
  nu: {
    // Pages 1-2 are a cover/ToC and the last page is boilerplate, but this
    // is just trimming noise — the table's own TRANSACCIONES/Saldo final
    // markers are what actually scope the transactions either way.
    pageRange: (pages) => ({ first: 3, last: pages - 1 }),
  },
  bbva: {
    // The transaction table starts on page 1; Detalle de Movimientos
    // Realizados/Total de Movimientos markers scope it from there, so
    // there's no cover page to trim.
    pageRange: (pages) => ({ first: 1, last: pages }),
    // Only statements through 2024 are encrypted; 2025+ files ignore this.
    passwordEnv: "BBVA_PDF_PASSWORD",
  },
};

export function getExtractProfile(provider: string): ExtractProfile {
  return profiles[provider] ?? defaultProfile;
}
