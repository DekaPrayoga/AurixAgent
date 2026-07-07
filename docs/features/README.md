# Aurix Feature Docs

This directory contains feature-level operational documentation for Aurix Agent.

These files are written for two audiences:

1. Human maintainers who need to understand a feature quickly.
2. AI coding agents that need clear instructions before editing a cross-file feature.

The docs are intentionally feature-scoped, not file-scoped. Do not create one markdown file for every source file. Create a feature doc only when a feature has user commands, config/env variables, persisted state, gateway behavior, external APIs, or multi-file invariants.

## Feature docs

- [Web Search](./web-search.md)
- [Cron Automation](./cron-automation.md)
- [Vision Fallback](./vision-fallback.md)
- [Setup and Config](./setup-config.md)
- [Session Store](./session-store.md)
- [Gateway](./gateway.md)
- [Multi-Agent Orchestration](./multi-agent.md)

## When to add a new feature doc

Add a new doc when a feature has at least one of these properties:

- User-facing slash command or gateway command.
- YAML/env config fields.
- SQLite or file-backed persistence.
- External API/provider integration.
- Multi-platform behavior.
- Multi-file runtime flow.
- Known failure modes that are not obvious from one file.

Do not add a doc for tiny helper functions, one-off utilities, or purely internal components whose behavior is obvious from code.

## Required sections

A good Aurix feature doc should include:

- Purpose
- User-facing behavior
- Config and environment variables
- Source files
- Runtime flow
- Data/storage model if any
- Invariants to preserve
- Common failure modes
- Verification checklist

Keep docs accurate. If code changes behavior, update the relevant feature doc in the same commit.
