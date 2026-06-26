# Contributing

Thanks for helping improve postiz-mcp. It's a typed MCP client for the Postiz
public API, and the bar is "stays typed, stays tested, stays safe by default."

## Local setup

```bash
npm install
npm run typecheck && npm test && npm run build   # or: ./scripts/verify
```

`./scripts/verify` is the definition of done: typecheck, tests, and build must all pass.

## What lands easily

- Bug fixes with a test that fails before and passes after
- New or refreshed provider settings schemas (`npm run refresh-schemas`)
- Documentation: clearer config, examples, fixes

## What needs a conversation first

Open an issue before a PR for:

- **New tools** or changes to an existing tool's input/output shape
- **Anything that touches the gating boundary** (writes off by default, deletes
  requiring `enableDelete` + `confirm: true`, the rate-limit guard). These are
  safety guarantees, not implementation details.

## Rules

- **No secrets.** Never commit an API key, real `POSTIZ_URL`, hostname, private IP,
  or unredacted absolute path. A `content-guard` pre-push hook scans for these.
  Use `http://localhost:5000` / `https://postiz.example.com` in examples.
- **Keep writes gated.** A read-only change must not silently expose a write.
- **Conventional commits**, no AI co-authorship trailers.

Setting this up with an agent? See [AGENTS.md](AGENTS.md) for the full machine-readable guide.
