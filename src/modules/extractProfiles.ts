export type ExtractProfile = {
  pageRange: (totalPages: number) => { first: number; last: number };
  passwordEnv?: string;
};

const defaultProfile: ExtractProfile = {
  pageRange: (pages) => ({ first: 1, last: pages }),
};

const profiles: Record<string, ExtractProfile> = {
  nu: {
    // Pages 1-2 are a cover/ToC and the last page is boilerplate
    pageRange: (pages) => ({ first: 3, last: pages - 1 }),
  },
  bbva: {
    // The transaction table starts on page 1
    pageRange: (pages) => ({ first: 1, last: pages }),
    // Only PDFs requested via email are encrypted
    passwordEnv: "BBVA_PDF_PASSWORD",
  },
};

export function getExtractProfile(provider: string): ExtractProfile {
  return profiles[provider] ?? defaultProfile;
}
