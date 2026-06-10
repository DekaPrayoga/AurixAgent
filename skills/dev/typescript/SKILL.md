# TypeScript Development

Skill for writing clean, type-safe TypeScript across frontend and backend projects.

## Tools

- `terminal` — Run TypeScript compiler, linting, and test commands.
- `read_file` — Inspect existing source files to understand types and interfaces.
- `write_file` — Create or update TypeScript source files.
- `code_exec` — Execute TypeScript snippets for quick validation or prototyping.

## Instructions

- Enable `strict: true` in `tsconfig.json` and never weaken individual strict flags.
- Prefer explicit, named types over `any`; use `unknown` when the type is genuinely uncertain.
- Define `interface` for object shapes and `type` for unions, intersections, and primitives.
- Use generics to write reusable, type-safe utility functions and components.
