/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { createMemo, createSignal, For, Show } from "solid-js"

type TaskStatus = "pending" | "running" | "completed" | "error"

type WorkflowProgress = {
  version: 1
  name: string
  status: "running" | "completed"
  phase: string
  path?: string
  completed: number
  total: number
  tasks: Array<{
    id: string
    label: string
    status: TaskStatus
    activity?: string
    toolCalls: number
    tokens: number
  }>
}

type WorkflowState = {
  sessionID: string
  updatedAt: number
  progress: WorkflowProgress
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function parse(value: unknown): WorkflowProgress | undefined {
  const progress = record(value)
  if (!progress || progress.version !== 1 || progress.status !== "running" || typeof progress.name !== "string") return
  if (typeof progress.phase !== "string" || typeof progress.completed !== "number" || typeof progress.total !== "number") {
    return
  }
  if (!Array.isArray(progress.tasks)) return

  const tasks = progress.tasks.flatMap((value) => {
    const task = record(value)
    if (!task) return []
    if (typeof task.id !== "string" || typeof task.label !== "string") return []
    if (typeof task.status !== "string" || !["pending", "running", "completed", "error"].includes(task.status)) return []
    if (typeof task.toolCalls !== "number" || typeof task.tokens !== "number") return []
    return [task as WorkflowProgress["tasks"][number]]
  })

  return { ...(progress as Omit<WorkflowProgress, "tasks">), tasks }
}

function parseState(value: unknown): WorkflowState | undefined {
  const state = record(value)
  if (!state || typeof state.sessionID !== "string" || typeof state.updatedAt !== "number") return
  const progress = parse(state.progress)
  if (!progress) return
  return { sessionID: state.sessionID, updatedAt: state.updatedAt, progress }
}

function number(value: number) {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}m`
}

function detail(task: WorkflowProgress["tasks"][number]) {
  return [
    task.toolCalls ? `${task.toolCalls} tool${task.toolCalls === 1 ? "" : "s"}` : undefined,
    task.tokens ? `${number(task.tokens)} tokens` : undefined,
  ]
    .filter(Boolean)
    .join(" | ")
}

function marker(status: TaskStatus) {
  if (status === "completed") return "+"
  if (status === "error") return "x"
  if (status === "running") return "*"
  return "."
}

function currentSession(api: TuiPluginApi) {
  const route = api.route.current
  if (route.name !== "session" || !("params" in route)) return
  return typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
}

function View(props: { api: TuiPluginApi; runs: () => Map<string, WorkflowState> }) {
  const theme = () => props.api.theme.current
  const run = createMemo(() => {
    const sessionID = currentSession(props.api)
    if (!sessionID) return
    return props.runs().get(sessionID)?.progress
  })
  const tasks = createMemo(() => run()?.tasks.slice(0, 8) ?? [])

  return (
    <Show when={run()}>
      {(active: () => WorkflowProgress) => (
        <box
          width="100%"
          flexShrink={0}
          flexDirection="column"
          border={["top"]}
          borderColor={theme().border}
          paddingLeft={3}
          paddingRight={3}
        >
          <text fg={theme().text}>
            <b>Workflow</b> {active().name} | {active().phase}
            <Show when={active().total}>
              <span style={{ fg: theme().textMuted }}>
                {" "}| {active().completed}/{active().total}
              </span>
            </Show>
          </text>
          <For each={tasks()}>
            {(task) => (
              <box flexDirection="column" paddingLeft={2}>
                <text fg={task.status === "error" ? theme().error : theme().textMuted}>
                  {marker(task.status)} {task.label}
                  <Show when={detail(task)}> | {detail(task)}</Show>
                </text>
                <Show when={task.activity}>
                  <text fg={theme().textMuted} paddingLeft={2}>
                    - {task.activity}
                  </text>
                </Show>
              </box>
            )}
          </For>
          <Show when={active().tasks.length > tasks().length}>
            <text fg={theme().textMuted} paddingLeft={2}>
              ... {active().tasks.length - tasks().length} more
            </text>
          </Show>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  const [runs, setRuns] = createSignal(new Map<string, WorkflowState>())
  const directory = path.resolve(api.state.path.directory, ".opencode/workflows/progress")
  let reading = false
  async function refresh() {
    if (reading) return
    reading = true
    try {
      const files = await readdir(directory).catch(() => [])
      const states = await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map(async (file) => {
            const value = await readFile(path.join(directory, file), "utf8").catch(() => "")
            if (!value) return
            try {
              return parseState(JSON.parse(value))
            } catch {
              return
            }
          }),
      )
      setRuns(new Map(states.flatMap((state) => (state ? [[state.sessionID, state] as const] : []))))
    } finally {
      reading = false
    }
  }
  void refresh()
  const timer = setInterval(refresh, 150)
  api.lifecycle.onDispose(() => clearInterval(timer))

  api.slots.register({
    order: 50,
    slots: {
      app_bottom() {
        return <View api={api} runs={runs} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "daleal.workflows",
  tui,
}

export default plugin
