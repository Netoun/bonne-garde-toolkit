export interface Branding {
  displayName: string;
  shortName: string;
  description: string;
  lang: string;
  themeColor: string;
  backgroundColor: string;
  npmScope: string;
  publicOrigin: string;
  supportEmail: string;
  legalName: string;
}

export const BRANDING_KEYS = [
  "displayName",
  "shortName",
  "description",
  "lang",
  "themeColor",
  "backgroundColor",
  "npmScope",
  "publicOrigin",
  "supportEmail",
  "legalName",
] as const satisfies ReadonlyArray<keyof Branding>;
