# Project Rules

- Use `bun` instead of `npm` or `npx` for package management, running scripts, and development servers in this project.
- In the Rust demo parser, always access the entities list using `ctx.entities()` (method call), never `ctx.entities` (field access).
