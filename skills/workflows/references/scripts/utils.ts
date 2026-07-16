import {
  createOpencode,
  type AssistantMessage,
  type Event,
  type OpencodeClient,
  type ServerOptions,
  type Session,
  type SessionStatus,
  type ToolPart,
} from "@opencode-ai/sdk/v2"
import { z } from "zod"

type PromptInput = Parameters<OpencodeClient["session"]["prompt"]>[0]

export type StructuredPromptInput<Schema extends z.ZodType> = Omit<PromptInput, "format" | "noReply"> & {
  schema: Schema
  retryCount?: number
}

export type WorkflowTaskStatus = "pending" | "running" | "completed" | "error"

export type WorkflowProgress = {
  version: 1
  name: string
  status: "running" | "completed"
  phase: string
  startedAt: number
  completed: number
  total: number
  coordinatorSessionId?: string
  tasks: Array<{
    id: string
    label: string
    status: WorkflowTaskStatus
    sessionId: string
    activity?: string
    toolCalls: number
    tokens: number
    startedAt: number
    finishedAt?: number
  }>
}

export type WorkflowRuntime = {
  signal: AbortSignal
  report(progress: WorkflowProgress): void
}

export type WorkflowReporter = {
  phase(label: string): void
}

type TrackedSession = {
  info: Session
  status: WorkflowTaskStatus
  sessionStatus?: SessionStatus
  tools: Map<string, ToolPart>
  tokens: Map<string, number>
  finishedAt?: number
}

function tokenCount(message: AssistantMessage) {
  return message.tokens.total ?? message.tokens.input + message.tokens.output + message.tokens.reasoning
}

function value(input: Record<string, unknown>) {
  for (const key of ["description", "query", "path", "filePath", "pattern", "url", "name"]) {
    const candidate = input[key]
    if (typeof candidate === "string" && candidate) return candidate.replace(/\s+/g, " ").slice(0, 80)
  }
}

function activity(part: ToolPart) {
  const detail = value(part.state.input ?? {})
  return detail ? `${part.tool} ${detail}` : part.tool
}

function observe(runtime: WorkflowRuntime, name: string) {
  const startedAt = Date.now()
  const sessions = new Map<string, TrackedSession>()
  let phase = "Starting workflow"
  let workflowStatus: WorkflowProgress["status"] = "running"
  let timer: ReturnType<typeof setTimeout> | undefined

  function snapshot(): WorkflowProgress {
    const roots = [...sessions.values()].filter((session) => !session.info.parentID)
    const tasks = [...sessions.values()]
      .filter((session) => session.info.parentID)
      .sort((a, b) => a.info.time.created - b.info.time.created)
      .map((session) => {
        const running = [...session.tools.values()].findLast((part) => part.state.status === "running")
        const toolCalls = [...session.tools.values()].filter(
          (part) => part.state.status === "completed" || part.state.status === "error",
        ).length
        const retry = session.sessionStatus?.type === "retry" ? session.sessionStatus : undefined
        return {
          id: session.info.id,
          label: session.info.title,
          status: session.status,
          sessionId: session.info.id,
          activity: retry
            ? `Retrying (attempt ${retry.attempt})`
            : running
              ? activity(running)
              : session.status === "running"
                ? "Thinking"
                : session.status === "completed"
                  ? "Done"
                  : undefined,
          toolCalls,
          tokens: [...session.tokens.values()].reduce((sum, count) => sum + count, 0),
          startedAt: session.info.time.created,
          ...(session.finishedAt ? { finishedAt: session.finishedAt } : {}),
        }
      })

    return {
      version: 1,
      name,
      status: workflowStatus,
      phase,
      startedAt,
      completed: tasks.filter((task) => task.status === "completed").length,
      total: tasks.length,
      coordinatorSessionId: roots[0]?.info.id,
      tasks,
    }
  }

  function report(immediate = false) {
    if (immediate) {
      if (timer) clearTimeout(timer)
      timer = undefined
      runtime.report(snapshot())
      return
    }
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      runtime.report(snapshot())
    }, 150)
  }

  function event(event: Event) {
    if (event.type === "session.created") {
      sessions.set(event.properties.info.id, {
        info: event.properties.info,
        status: "pending",
        tools: new Map(),
        tokens: new Map(),
      })
      report()
      return
    }

    if (event.type === "session.updated") {
      const session = sessions.get(event.properties.info.id)
      if (!session) return
      session.info = event.properties.info
      report()
      return
    }

    if (event.type === "session.status") {
      const session = sessions.get(event.properties.sessionID)
      if (!session) return
      session.sessionStatus = event.properties.status
      if (event.properties.status.type === "busy" || event.properties.status.type === "retry") {
        session.status = "running"
        session.finishedAt = undefined
      } else if (session.status === "running") {
        session.status = "completed"
        session.finishedAt = Date.now()
      }
      report()
      return
    }

    if (event.type === "session.error") {
      if (!event.properties.sessionID) return
      const session = sessions.get(event.properties.sessionID)
      if (!session) return
      session.status = "error"
      session.finishedAt = Date.now()
      report(true)
      return
    }

    if (event.type === "message.updated") {
      const session = sessions.get(event.properties.sessionID)
      const message = event.properties.info
      if (!session || message.role !== "assistant") return
      session.tokens.set(message.id, tokenCount(message))
      report()
      return
    }

    if (event.type === "message.part.updated") {
      const session = sessions.get(event.properties.sessionID)
      const part = event.properties.part
      if (!session || part.type !== "tool") return
      session.tools.set(part.id, part)
      report()
    }
  }

  report(true)
  return {
    event,
    phase(label: string) {
      phase = label
      report(true)
    },
    complete() {
      workflowStatus = "completed"
      report(true)
    },
    dispose() {
      if (timer) clearTimeout(timer)
    },
  }
}

export async function promptStructured<Schema extends z.ZodType>(
  client: OpencodeClient,
  input: StructuredPromptInput<Schema>,
): Promise<z.output<Schema>> {
  const { schema, retryCount, ...prompt } = input
  const result = await client.session.prompt(
    {
      ...prompt,
      format: {
        type: "json_schema",
        schema: z.toJSONSchema(schema),
        retryCount,
      },
    },
    { throwOnError: true },
  )
  if (!result.data) throw new Error("Structured prompt returned no data")

  return schema.parse(result.data.info.structured)
}

export async function workflow<Result>(
  runtime: WorkflowRuntime,
  name: string,
  run: (client: OpencodeClient, progress: WorkflowReporter) => Promise<Result>,
  options: ServerOptions = { port: 0 },
): Promise<Result> {
  name = name.trim()
  if (!name) throw new Error("Workflow name is required")
  const opencode = await createOpencode(options)
  if (runtime.signal.aborted) {
    opencode.server.close()
    throw new Error("Workflow was cancelled")
  }
  const progress = observe(runtime, name)
  const controller = new AbortController()
  const abort = () => {
    controller.abort()
    opencode.server.close()
  }
  runtime.signal.addEventListener("abort", abort, { once: true })
  const events = await opencode.client.event.subscribe(undefined, { signal: controller.signal })
  const watcher = (async () => {
    for await (const event of events.stream) progress.event(event)
  })().catch(() => {})
  try {
    const result = await run(opencode.client, progress)
    progress.complete()
    return result
  } finally {
    runtime.signal.removeEventListener("abort", abort)
    controller.abort()
    progress.dispose()
    opencode.server.close()
    await watcher
  }
}

export function text(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
}

export { z }
export type { OpencodeClient, ServerOptions }
