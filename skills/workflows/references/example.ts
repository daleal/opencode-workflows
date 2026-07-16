import { promptStructured, workflow, text, z, type WorkflowRuntime } from "./scripts/utils.js"

const Plan = z.object({
  tasks: z.array(z.string()),
})

export default (runtime: WorkflowRuntime) =>
  workflow(runtime, "Parallel code review", async (client, progress) => {
    progress.phase("Planning review tasks")
    const session = await client.session.create({
      model: {
        providerID: "openai",
        id: "gpt-5.6-sol",
        variant: "high",
      }
    }, { throwOnError: true })

    const plan = await promptStructured(client, {
      sessionID: session.data.id,
      parts: [{ type: "text", text: "Inspect this project and break a thorough code review into independent tasks." }],
      schema: Plan,
    })

    progress.phase("Running parallel reviews")
    const reports = await Promise.all(
      plan.tasks.map(async (task) => {
        const worker = await client.session.create(
          {
            parentID: session.data.id,
            title: task,
            agent: "general",
            model: {
              providerID: "openai",
              id: "gpt-5.6-sol",
              variant: "medium",
            },
          },
          { throwOnError: true },
        )

        const response = await client.session.prompt(
          {
            sessionID: worker.data.id,
            parts: [
              {
                type: "text",
                text: `Complete this task independently. Investigate the project, then report concrete findings with file references:\n\n${task}`,
              },
            ],
          },
          { throwOnError: true },
        )

        return { task, report: text(response.data.parts) }
      }),
    )

    progress.phase("Synthesizing findings")
    const response = await client.session.prompt(
      {
        sessionID: session.data.id,
        model: {
          providerID: "openai",
          modelID: "gpt-5.6-luna",
        },
        variant: "high",
        parts: [
          {
            type: "text",
            text: `Synthesize the parallel worker reports below into one concise, prioritized code review. Remove duplicates and preserve file references.\n\n${JSON.stringify(reports, null, 2)}`,
          },
        ],
      },
      { throwOnError: true },
    )

    return {
      plan,
      reports,
      summary: text(response.data.parts),
    }
  })
