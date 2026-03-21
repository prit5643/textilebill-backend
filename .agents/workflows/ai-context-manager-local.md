---
description: How to install and use AI Context Manager locally
---

# Local Installation & Usage

If you prefer to keep AI Context Manager confined to a single project, rather than installing it globally, you can install it as a development dependency.

## 1. Install locally
Run this inside your project folder (e.g. `textilebill-backend`):
```bash
npm install -D @jenishk29/ai-context-manager
```
// turbo

## 2. Initialize in Your Project
Because it is installed locally, use `npx` to execute the local package binary:
```bash
npx acm init
```
// turbo

*(Note: If you run only `acm init`, it may fail because the binary is not globally available in your PATH).*

## 3. Generate a Snapshot
Similarly, prefix the execution with `npx`:
```bash
npx acm snapshot
```
// turbo

This instructs npm to look inside your `node_modules/.bin/` folder for the executable.
