export interface Branding {
  displayName: string;
  shortName: string;
  npmScope: string;
  publicOrigin: string;
  supportEmail: string;
  legalName: string;
}

export const BRANDING_KEYS = [
  "displayName",
  "shortName",
  "npmScope",
  "publicOrigin",
  "supportEmail",
  "legalName",
] as const satisfies ReadonlyArray<keyof Branding>;
