# Go Development

Skill for writing clean, idiomatic Go for services, CLIs, and infrastructure tooling.

## Tools

- `terminal` — Run go build, test, vet, and other Go toolchain commands.
- `read_file` — Inspect existing Go source files and module definitions.
- `write_file` — Create or update Go source files and project configuration.
- `code_exec` — Execute Go snippets for quick validation or prototyping.

## Instructions

- Always run `go fmt` (or `gofmt`) before committing to maintain consistent formatting.
- Handle errors explicitly — never ignore returned errors; wrap them with `fmt.Errorf` for context.
- Favor interface-based design to decouple components and simplify testing with mocks.
- Use `context.Context` as the first parameter in functions that may block or be cancelled.
