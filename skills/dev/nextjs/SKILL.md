# Next.js Development

Skill for building full-stack React applications with the Next.js framework.

## Tools

- `scaffold_project` — Initialize a new Next.js project with App Router and TypeScript.
- `generate_component` — Generate server or client components with correct directives.
- `build_check` — Run a production build to catch errors before deployment.

## Instructions

- Use the App Router (`app/` directory) for all new Next.js projects — avoid the legacy Pages router.
- Default to server components; add `"use client"` only when interactivity or browser APIs are required.
- Define proper metadata with `generateMetadata` or static `metadata` exports on every page for SEO.
- Use `next/image`, `next/font`, and built-in optimizations to keep bundle sizes small.
