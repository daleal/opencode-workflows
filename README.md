# @daleal/opencode-workflows

Structured TypeScript workflows for OpenCode, including the `workflows` skill, the `run-workflow` tool, and TUI progress reporting.

## Install

Use OpenCode's **Install plugin** command and enter `@daleal/opencode-workflows`. OpenCode detects both package entrypoints and updates the server and TUI configurations.

For manual installation, add the package to both files.

`opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@daleal/opencode-workflows"]
}
```

`tui.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@daleal/opencode-workflows"]
}
```

Restart OpenCode after changing either configuration file.
