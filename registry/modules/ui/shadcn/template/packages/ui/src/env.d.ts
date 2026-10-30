// packages/ui holds no TypeScript until the first item adds a component, and `tsc --noEmit` fails
// with TS18003 when a project has no input file. This file is that input: nothing else belongs here.
export {};
