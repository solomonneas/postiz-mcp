# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases before this changelog was started are on [npm](https://www.npmjs.com/package/postiz-mcp?activeTab=versions).

## [Unreleased]

### Added
- Project governance: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue
  and pull-request templates.
- Pull-request and `main` branch verification on Node.js 20 and 22.

### Changed
- README now leads with a recorded terminal demo (`docs/assets/postiz-tools.svg`,
  reproducible from `docs/assets/postiz-tools.cast`): install, the safe-by-default
  config gate, and the 22 typed tools listed via the MCP inspector.
- Refreshed dependencies within their declared version ranges. The production
  dependency audit now reports no known vulnerabilities.
- Updated workflow actions and replaced contributor instructions that referenced
  a missing verification script with the commands the repository provides.
