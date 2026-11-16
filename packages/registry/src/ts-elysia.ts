import {
  Node,
  VariableDeclarationKind,
  type CallExpression,
  type NewExpression,
  type VariableDeclaration,
} from "ts-morph";
import type { RegionState } from "./region-state";
import { ownLineIndent, eolOf } from "./text-layout";
import { endWithComments, parseTypeScript } from "./ts-source";

/**
 * `ts.elysiaUse` (spec 060): `.use(<argument>)` in the method chain `export const <targetName> =
 * new Elysia(...)...`, after the last `.use` that leads it and before the first call that is not
 * one, which is where Elysia wants a plugin registered before the routes that depend on it. ts-morph
 * finds the node; the edit is one line of text put right after it, so every other byte stays and
 * what is written is what the project's formatter writes: `.use(argument)` on a line of its own,
 * indented like the call it follows. The region is `elysia[<targetName>].use[<argument>]`.
 */

const PRINT_WIDTH = 100;

export const elysiaRegion = (targetName: string, argument: string): string =>
  `elysia[${targetName}].use[${argument}]`;

export function parseElysiaRegion(region: string): { targetName: string; argument: string } | null {
  const [, targetName, argument] = /^elysia\[([^\]]+)\]\.use\[([^\]]+)\]$/.exec(region) ?? [];
  return targetName === undefined || argument === undefined ? null : { targetName, argument };
}

type Target = { targetName: string; argument: string };

type Chain = { root: NewExpression; calls: CallExpression[] };

/** A parenthesis, `satisfies`, `as` and `!` around an expression change nothing about what it is. */
function unwrap(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current !== undefined &&
    (Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

/** The calls of a chain rooted at `new Elysia(...)`, innermost first, or `null` when it is no such chain. */
function chainOf(declaration: VariableDeclaration): Chain | null {
  const calls: CallExpression[] = [];
  let node = unwrap(declaration.getInitializer());
  while (node !== undefined) {
    if (Node.isNewExpression(node)) {
      const callee = node.getExpression();
      return Node.isIdentifier(callee) && callee.getText() === "Elysia"
        ? { root: node, calls }
        : null;
    }
    if (!Node.isCallExpression(node)) {
      return null;
    }
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) {
      return null;
    }
    calls.unshift(node);
    node = unwrap(callee.getExpression());
  }
  return null;
}

function isUse(call: CallExpression): boolean {
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) && callee.getName() === "use";
}

function usesArgument(call: CallExpression, argument: string): boolean {
  const [only, ...rest] = call.getArguments();
  return (
    isUse(call) &&
    rest.length === 0 &&
    only !== undefined &&
    Node.isIdentifier(only) &&
    only.getText() === argument
  );
}

type Planned =
  | { ok: true; state: RegionState; edit: { offset: number; content: string } | null }
  | { ok: false; reason: string };

/** `{ ok: true, chain: null }` is a file that parses and has no such chain: nothing to read a region from. */
function locate(
  file: string,
  text: string,
  targetName: string,
): { ok: true; found: { chain: Chain } | { why: string } } | { ok: false; reason: string } {
  const parsed = parseTypeScript(file, text);
  if (!parsed.ok) {
    return parsed;
  }
  const declaration = parsed.source.getVariableDeclaration(targetName);
  const statement = declaration?.getVariableStatement();
  if (
    declaration === undefined ||
    statement === undefined ||
    !statement.isExported() ||
    statement.getDeclarationKind() !== VariableDeclarationKind.Const
  ) {
    return { ok: true, found: { why: `no exported const ${targetName}` } };
  }
  const chain = chainOf(declaration);
  return {
    ok: true,
    found:
      chain === null
        ? { why: `${targetName} is not a chain of calls rooted at new Elysia(...)` }
        : { chain },
  };
}

function plan(file: string, text: string, { targetName, argument }: Target): Planned {
  const located = locate(file, text, targetName);
  if (!located.ok) {
    return located;
  }
  if ("why" in located.found) {
    return { ok: false, reason: located.found.why };
  }
  const { root, calls } = located.found.chain;
  if (calls.some((call) => usesArgument(call, argument))) {
    return { ok: true, state: { kind: "equal" }, edit: null };
  }

  // The leading run of `.use` calls: the new one follows its last, or the root when there is none.
  const leading = calls.findIndex((call) => !isUse(call));
  const uses = leading === -1 ? calls : calls.slice(0, leading);
  const anchor = uses.at(-1) ?? root;
  const reference = uses.at(-1) ?? calls[0];
  const absent: RegionState = { kind: "absent" };
  const offset = endWithComments(anchor);
  const written = `.use(${argument})`;

  if (reference === undefined) {
    // `new Elysia(...)` alone: one call fits on its line, or the formatter would lay it out otherwise.
    const rest = text.indexOf("\n", offset);
    const line = text.slice(
      text.lastIndexOf("\n", offset - 1) + 1,
      rest === -1 ? text.length : rest,
    );
    return line.replace(/\r$/, "").length + written.length <= PRINT_WIDTH
      ? { ok: true, state: absent, edit: { offset, content: written } }
      : {
          ok: false,
          reason: `.use(${argument}) would take ${targetName} past ${PRINT_WIDTH} columns: add it by hand and let the formatter lay it out`,
        };
  }
  const callee = reference.getExpression();
  const dot = Node.isPropertyAccessExpression(callee)
    ? text.lastIndexOf(".", callee.getNameNode().getStart())
    : -1;
  const indent = dot === -1 ? null : ownLineIndent(text, dot);
  if (indent === null) {
    return {
      ok: false,
      reason: `${targetName} is a chain on one line: add ${written} by hand and let the formatter lay it out`,
    };
  }
  return {
    ok: true,
    state: absent,
    edit: { offset, content: `${eolOf(text)}${indent}${written}` },
  };
}

export type ElysiaInspection = { ok: true; state: RegionState } | { ok: false; reason: string };

export function inspectElysiaUse(
  file: string,
  text: string,
  targetName: string,
  argument: string,
): ElysiaInspection {
  const planned = plan(file, text, { targetName, argument });
  return planned.ok ? { ok: true, state: planned.state } : planned;
}

export function addElysiaUse(
  file: string,
  text: string,
  targetName: string,
  argument: string,
): string {
  const planned = plan(file, text, { targetName, argument });
  if (!planned.ok) {
    throw new Error(planned.reason);
  }
  const { edit } = planned;
  return edit === null
    ? text
    : `${text.slice(0, edit.offset)}${edit.content}${text.slice(edit.offset)}`;
}

/** Whether the chain still has the `.use`, for a reader (`doctor`) that has no module.json. */
export function readElysiaRegion(
  file: string,
  text: string,
  { targetName, argument }: Target,
): { ok: true; present: boolean } | { ok: false; reason: string } {
  const located = locate(file, text, targetName);
  if (!located.ok) {
    return located;
  }
  return {
    ok: true,
    present:
      "chain" in located.found &&
      located.found.chain.calls.some((call) => usesArgument(call, argument)),
  };
}
