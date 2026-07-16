import { mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { inspect } from "node:util"
import { pathToFileURL } from "node:url"
import { tool } from "@opencode-ai/plugin"

type WorkflowProgress = {
  name?: string
  status: "running" | "completed"
  phase: string
  [key: string]: unknown
}

type WorkflowState = {
  sessionID: string
  updatedAt: number
  progress: WorkflowProgress & { path: string }
}

function isWithin(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export default tool({
  description: "Run a TypeScript workflow from the project's .opencode/workflows/runtime directory. Used exclusively to run workflows generated with the guidance of the `workflows` skill",
  args: {
    path: tool.schema.string().describe("Workflow path relative to .opencode/workflows/runtime"),
  },
  async execute(args, context) {
    if (path.isAbsolute(args.path) || path.extname(args.path) !== ".ts") {
      throw new Error("Workflow path must be a relative .ts file")
    }

    const root = path.resolve(context.directory, ".opencode/workflows/runtime")
    const script = path.resolve(root, args.path)
    if (!isWithin(root, script)) {
      throw new Error("Workflow path must stay within .opencode/workflows/runtime")
    }

    const [resolvedRoot, resolvedScript] = await Promise.all([realpath(root), realpath(script)])
    if (!isWithin(resolvedRoot, resolvedScript)) {
      throw new Error("Workflow symlinks must stay within .opencode/workflows/runtime")
    }
    if (!(await stat(resolvedScript)).isFile()) {
      throw new Error("Workflow path must reference a file")
    }

    await context.ask({
      permission: "run-workflow",
      patterns: [resolvedScript],
      always: [resolvedScript],
      metadata: { script: resolvedScript },
    })

    const url = pathToFileURL(resolvedScript)
    url.searchParams.set("run", crypto.randomUUID())

    const stateDirectory = path.resolve(context.directory, ".opencode/workflows/progress")
    const stateFile = path.join(stateDirectory, `${context.sessionID}.json`)
    await mkdir(stateDirectory, { recursive: true })
    let writes = Promise.resolve()
    function persist(next: WorkflowProgress & { path: string }) {
      const state: WorkflowState = { sessionID: context.sessionID, updatedAt: Date.now(), progress: next }
      writes = writes.catch(() => {}).then(async () => {
        const temporary = `${stateFile}.${crypto.randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify(state))
        await rename(temporary, stateFile)
      })
    }

    let progress: WorkflowProgress & { path: string } = {
      version: 1,
      status: "running",
      phase: "Loading workflow",
      path: args.path,
      startedAt: Date.now(),
      completed: 0,
      total: 0,
      tasks: [],
    }
    persist(progress)
    try {
      const module = await import(url.href)
      const result =
        typeof module.default === "function"
          ? await module.default({
              signal: context.abort,
              report(next: WorkflowProgress) {
                progress = { ...next, path: args.path }
                persist(progress)
              },
            })
          : undefined

      progress = { ...progress, status: "completed" }
      await writes
      return {
        title: `${progress.name ?? args.path} · ${progress.phase}`,
        output: result === undefined ? "Workflow completed successfully." : inspect(result, { depth: 8 }),
        metadata: { workflow: progress },
      }
    } finally {
      await writes.catch(() => {})
      await rm(stateFile, { force: true })
    }
  },
})
