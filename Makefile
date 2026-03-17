SHELL := /bin/sh

.PHONY: help install dev build start lint

help:
	@printf '%s\n' \
		'install   Install workspace dependencies' \
		'dev       Run the Next.js web app' \
		'build     Build the Next.js web app' \
		'start     Start the production web server' \
		'lint      Run the Next.js linter'

install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

start:
	pnpm start

lint:
	pnpm lint
