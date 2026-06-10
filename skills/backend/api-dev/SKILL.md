# Backend API Development

Skill for designing and building robust, secure backend APIs.

## Tools

- `scaffold_api` — Initialize a new API project with routing, middleware, and folder structure.
- `generate_schema` — Generate database schemas or request/response models.
- `generate_endpoint` — Scaffold a new API endpoint with handler, validation, and tests.
- `setup_auth` — Configure authentication and authorization middleware.
- `generate_dockerfile` — Create a production-ready Dockerfile for the API service.

## Instructions

- Validate all incoming data at the boundary using a schema library (Zod, Joi, Pydantic, etc.).
- Return proper HTTP status codes: 200/201 for success, 400 for bad input, 401/403 for auth, 500 for server errors.
- Store all secrets and configuration in environment variables — never hardcode them in source.
- Add structured logging and meaningful error messages to aid debugging in production.
