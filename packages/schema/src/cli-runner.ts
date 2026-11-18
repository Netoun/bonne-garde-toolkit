/** The CLI's name: its npm package and its one bin. */
const CLI_NAME = "bonne-garde";

/**
 * How to run the CLI with the package manager named in an `npm_config_user_agent`
 * (`pnpm/9.12.0 npm/? node/v22.12.0 ...`), so a command printed for someone to copy runs the way they
 * started it. One that names none of them, or none at all, is `npx`: it ships with Node.
 */
export function runnerFor(userAgent: string | undefined): string {
  const manager = userAgent?.split("/", 1)[0];
  const runner =
    manager === "bun"
      ? "bunx"
      : manager === "pnpm"
        ? "pnpm dlx"
        : manager === "yarn"
          ? "yarn dlx"
          : "npx";
  return `${runner} ${CLI_NAME}`;
}

/**
 * The runner a file written into a project names. A project is a Bun monorepo, and the same call must
 * write the same bytes whoever runs it, so this does not follow the user agent.
 */
export const PROJECT_RUNNER = runnerFor("bun");

/** `runnerFor` the package manager that started this process: the prefix of every command the CLI prints. */
export function cliRunner(): string {
  return runnerFor(process.env.npm_config_user_agent);
}
