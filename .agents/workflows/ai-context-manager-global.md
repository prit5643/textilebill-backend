---
description: How to install and use AI Context Manager globally
---

# Global Installation & Usage

This workflow assumes the path bug in `ai-context-manager` is fixed. Once published or linked, follow these steps to use the ACM tool globally across all your projects.

## 1. Clean up old global packages (optional)
Remove any broken global installations:
```bash
npm uninstall -g @jenishk29/ai-context-manager
```
// turbo

## 2. Install the package globally
Install it so that it is available directly from your command line as `acm`:
```bash
npm install -g @jenishk29/ai-context-manager
```
// turbo

*(Note: Depending on your system permissions, you may not need `sudo` on Windows).*

## 3. Verify Installation
Check that the command runs globally:
```bash
acm --version
```
// turbo

## 4. Usage in any project
Navigate to any project directory and initialize it:
```bash
acm init
```

Take a snapshot:
```bash
acm snapshot
```
