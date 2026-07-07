# Security Policy

## Supported Scope

Security reports are accepted for the current `main` branch of this repository.

Relevant report areas include:

- secret, token, account, order, or execution data exposure
- Local Operations API or MCP tool access-control issues
- paths that could enable live order placement, broker mutation, raw `codex exec`, raw `tossctl`, or `place_order` by default
- paper-only replay or Risk Engine boundary bypasses
- dependency or build configuration issues that affect this repository

## Reporting

Do not publish secrets, account data, token values, private broker data, or exploit details in public issues, public PR comments, or public review threads.

Use GitHub private vulnerability reporting when it is enabled for this repository. If private reporting is unavailable, contact the repository owner out of band before public disclosure.

Reports should include:

- affected file, endpoint, tool, or workflow
- reproducible steps
- expected safe behavior
- observed unsafe behavior
- whether any secret or private data was exposed

## Safety Boundary

This repository is paper-only and safe-by-default. Security reports must not request or demonstrate live trading, broker mutation, natural language order placement, raw command execution surfaces, or investment advice.

This repository is source-available for public review. A security report does not grant permission to use, host, operate, redistribute, or create derivative works outside the license terms.
