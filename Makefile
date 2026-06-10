SHELL := /bin/bash
.PHONY: all setup build install run clean dev help

BUN := $(shell command -v bun 2>/dev/null || echo "$$HOME/.bun/bin/bun" 2>/dev/null)
NODE := $(shell command -v node 2>/dev/null)
KITTY := $(shell command -v kitty 2>/dev/null)

all: build

help:
	@echo "AURIX Agent — Makefile"
	@echo ""
	@echo "  make setup     Install Bun, kitty, and dependencies"
	@echo "  make build     Compile TypeScript → dist/"
	@echo "  make run       Launch AURIX (auto-detects kitty for black bg)"
	@echo "  make dev       Run in dev mode with tsx (no build needed)"
	@echo "  make install   Install aurix to /usr/local/bin"
	@echo "  make clean     Remove dist/"
	@echo ""

setup:
	@echo "==> Checking Bun runtime..."
	@if [ ! -x "$$HOME/.bun/bin/bun" ] && ! command -v bun &>/dev/null; then \
		echo "  Installing Bun..."; \
		curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh && bash /tmp/bun-install.sh; \
	else \
		echo "  Bun already installed"; \
	fi
	@export PATH="$$HOME/.bun/bin:$$PATH"
	@echo "==> Checking kitty terminal..."
	@if [ -z "$(KITTY)" ]; then \
		echo "  Installing kitty..."; \
		apt-get install -y kitty; \
	else \
		echo "  kitty already installed at $(KITTY)"; \
	fi
	@echo "==> Installing dependencies..."
	@export PATH="$$HOME/.bun/bin:$$PATH" && bun install
	@echo "==> Setup complete!"

build: setup
	@echo "==> Building TypeScript..."
	@export PATH="$$HOME/.bun/bin:$$PATH" && npx tsc
	@echo "==> Build complete!"

run:
	@bash bin/aurix

dev:
	@export PATH="$$HOME/.bun/bin:$$PATH" && npx tsx src/index.tsx

install: build
	@echo "==> Installing aurix to /usr/local/bin..."
	@chmod +x bin/aurix
	@ln -sf "$(CURDIR)/bin/aurix" /usr/local/bin/aurix
	@cp bin/aurix ~/.local/bin/aurix 2>/dev/null || true
	@echo "==> Done! Run: aurix"

clean:
	@rm -rf dist/
	@echo "==> Cleaned dist/"
