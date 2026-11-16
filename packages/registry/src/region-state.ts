/** What a file holds at one region, against what the patch that names it declares (spec 060). */
export type RegionState =
  | { kind: "absent" }
  | { kind: "equal" }
  /** `current` is what `--force` replaces (`null`: it has no text); `shown` is how a message quotes it. */
  | { kind: "differs"; current: string | null; shown: string };
