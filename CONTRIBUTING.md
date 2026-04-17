# Contributing

Thank you for helping improve the Protect Earth website.

## Development Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create local environment file:

```bash
cp .env.example .env
```

3. Start local development:

```bash
pnpm dev
```

## Branches and Pull Requests

1. Create a feature branch from main.
2. Keep commits focused and descriptive.
3. Open a pull request with a clear summary of user-facing and technical changes.
4. Include screenshots for visual/UI updates.

## Before You Open a PR

Run:

```bash
pnpm build
```

Also, please [lint](https://github.com/protect-earth/website?tab=readme-ov-file#linting) changes:

```bash
pnpm format:check
pnpm format:write
```

If your change touches scripts, content models, or data flow, also verify relevant sync commands in [docs/scripts.md](docs/scripts.md).

## Content and Data Model Changes

If you change collections, schemas, or sync script output:

1. Update schemas in [src/content.config.ts](src/content.config.ts).
2. Update page usage of getCollection(...), where required.
3. Update docs in [docs/concepts.md](docs/concepts.md), [docs/scripts.md](docs/scripts.md), and [docs/architecture.md](docs/architecture.md).

## Security and Secrets

1. Never commit `.env`.
2. Keep `.env.example` as placeholders only.
3. Run secret scanning before release work:

```bash
gitleaks git --redact
gitleaks dir --redact .
```

## Style and Scope

1. Prefer small, reviewable pull requests.
2. Avoid unrelated refactors in feature PRs.
3. Preserve existing style in touched files unless consistency fixes are part of the task.
