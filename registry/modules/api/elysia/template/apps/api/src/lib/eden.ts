/** Unwrap a callable API segment (parameterized route) or return as-is (static route). */
type RouteFn = (...args: unknown[]) => unknown;
type FirstArg<T extends RouteFn> = Parameters<T>[0];

export type ApiRoute<T> = T extends RouteFn ? ReturnType<T> : T;

/** Response data of an Eden endpoint method. */
export type EdenResponse<T extends RouteFn> =
  Awaited<ReturnType<T>> extends { data: infer Data } ? NonNullable<Data> : never;

/** Request body of an Eden endpoint method (excludes `query` and `headers`). */
export type EdenBody<T extends RouteFn> =
  NonNullable<FirstArg<T>> extends object
    ? Omit<NonNullable<FirstArg<T>>, "query" | "headers">
    : never;

/** Query params of an Eden endpoint method. */
export type EdenQuery<T extends RouteFn> =
  FirstArg<T> extends { query: infer Query } ? (Query extends object ? Query : never) : never;
