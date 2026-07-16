import { fileURLToPath } from "node:url"
import type { PluginModule } from "@opencode-ai/plugin"
import runWorkflow from "./run-workflow.ts"

const skillRoot = fileURLToPath(new URL("../skills", import.meta.url))

type ConfigWithSkills = {
  skills?: {
    paths?: string[]
    urls?: string[]
  }
}

const plugin: PluginModule & { id: string } = {
  id: "daleal.workflows",
  server: async () => ({
    config(config) {
      const configured = config as typeof config & ConfigWithSkills
      const paths = configured.skills?.paths ?? []
      configured.skills = {
        ...configured.skills,
        paths: paths.includes(skillRoot) ? paths : [...paths, skillRoot],
      }
      return Promise.resolve()
    },
    tool: {
      "run-workflow": runWorkflow,
    },
  }),
}

export default plugin
