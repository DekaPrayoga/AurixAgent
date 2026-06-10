# Docker Container Management

Manage Docker containers, images, and Dockerfiles for efficient application deployment.

## Tools

- `docker_manage` — Build, run, stop, and inspect containers and images.
- `generate_dockerfile` — Scaffold optimized Dockerfiles for any stack.

## Instructions

- Prefer multi-stage builds to keep final images small and free of build tooling.
- Start from minimal base images (e.g. Alpine or distroless) to reduce attack surface.
- Always run applications as a non-root user inside the container.
- Include a `HEALTHCHECK` directive so orchestrators can detect unhealthy containers.
