# Rust Development

Skill for writing safe, performant Rust for systems programming and tooling.

## Tools

- `terminal` — Run cargo build, test, clippy, and other Rust toolchain commands.
- `read_file` — Inspect existing Rust source files and Cargo manifests.
- `write_file` — Create or update Rust source files and project configuration.
- `code_exec` — Execute Rust snippets for quick validation or prototyping.

## Instructions

- Prefer `Result` and `Option` return types over `unwrap()`; handle errors explicitly.
- Run `cargo clippy` regularly and address all warnings before committing.
- Understand and follow ownership patterns — prefer borrowing (`&T`) over cloning when possible.
- Use `#[derive]` for common traits (`Debug`, `Clone`, `Serialize`) to reduce boilerplate.
