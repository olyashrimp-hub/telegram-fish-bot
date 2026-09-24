---
name: TypeScript test runtime
description: Workspace-specific guidance for running TypeScript tests when package-local binaries are not linked.
---

The API workspace should not assume that a transitive workspace binary such as `tsx` is available in its local `node_modules/.bin`. Node 24 can execute the API's TypeScript tests directly with `node --experimental-strip-types --test`.

**Why:** The workspace links tools per package, so a dependency used by another package may not be executable from the API package.

**How to apply:** Prefer the built-in Node test runner for small TypeScript unit tests in the API package unless the package explicitly declares its own test runner.

For one-off API integration scenarios that import workspace TypeScript packages and the database, Node's strip-types mode does not resolve extensionless directory imports reliably. Bundle the scenario with the API package's esbuild in CommonJS format; set `NODE_ENV=production` for scripts that import the logger so pino does not require the `pino-pretty` transport at runtime.

**Why:** The workspace database package uses extensionless source imports, while the API logger's development transport is resolved dynamically. Bundling and production logger mode keep the verification focused on application behavior rather than loader setup.

**How to apply:** Keep these integration scenarios outside the repository, clean all sentinel rows in a `finally` block, and stub outbound Telegram fetches so real chats are never contacted.