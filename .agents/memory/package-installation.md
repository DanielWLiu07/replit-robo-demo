---
name: Workspace package installation
description: Package installer callbacks target the workspace root and reject scoped package flags.
---

When a dependency must be added to a specific workspace package, use that package's explicit pnpm filter command rather than the generic package installer callback.

**Why:** The generic installer attempted to add packages to the workspace root and rejected `--filter` as an invalid package token, while the filtered pnpm command placed dependencies correctly.

**How to apply:** For artifact or service dependencies, run `pnpm --filter @workspace/<package> add <packages>` and verify the package manifest changed before restarting workflows.