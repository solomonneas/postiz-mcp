<!-- Keep this short; delete sections that do not apply. See CONTRIBUTING.md. -->

## What and why

<!-- One or two sentences on the user-visible change and the problem it solves. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New / changed tool or schema (opened an issue first per CONTRIBUTING.md)
- [ ] Docs
- [ ] Refactor with no tool-surface change

## Checklist

- [ ] `./scripts/verify` passes (typecheck + tests + build)
- [ ] Added or updated tests covering the change
- [ ] Updated the `Unreleased` section of `CHANGELOG.md` for any user-visible effect
- [ ] Writes/deletes stay gated off by default; no read-only change silently exposes a write
- [ ] No API keys, real `POSTIZ_URL`, hostnames, IPs, tokens, or unredacted absolute paths (content-guard will fail otherwise)
- [ ] Conventional commit messages, no AI co-authorship trailers
