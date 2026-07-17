# @daleal/opencode-workflows

Structured workflows support for OpenCode, _à la_ Claude Code ultracode workflows.

## Install

Use OpenCode's **Install plugin** command and enter `@daleal/opencode-workflows@0.1.3`.

For manual installation, add the package to `.opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@daleal/opencode-workflows@0.1.3"],
}
```

Restart OpenCode after changing the configuration file.

### Relevant Notes

- You **must** define the plugin in the `opencode.jsonc` file **inside** of the `.opencode` folder, **not** in the root of your project. Otherwise, OpenCode will not install the plugin SDK.
- You should define the version of the plugin to use as shown above. If you just use `@daleal/opencode-workflows`, you will not get the updates to the plugin when they are released (OC resolves that as `@daleal/opencode-workflows@latest` and never updates it).
