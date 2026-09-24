---
name: TypeScript test runtime
description: Workspace-specific guidance for running TypeScript tests when package-local binaries are not linked.
---

The API workspace should not assume that a transitive workspace binary such as `tsx` is available in its local `node_modules/.bin`. Node 24 can execute the API's TypeScript tests directly with `node --experimental-strip-types --test`.

**Why:** The workspace links tools per package, so a dependency used by another package may not be executable from the API package.

**How to apply:** Prefer the built-in Node test runner for small TypeScript unit tests in the API package unless the package explicitly declares its own test runner.