import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

function moduleUrl(relativePath: string): string {
  return pathToFileURL(join(process.cwd(), relativePath)).href;
}

test("fire_agent removes persisted and in-memory task state for the removed agent", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "max-fire-agent-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    mkdirSync(join(tempHome, ".max", "agents"), { recursive: true });

    const agents = await import(moduleUrl("src/copilot/agents.ts"));
    const toolsModule = await import(moduleUrl("src/copilot/tools.ts"));
    const dbModule = await import(moduleUrl("src/store/db.ts"));

    assert.equal(
      agents.createAgentFile("cleanup-agent", "Cleanup Agent", "Handles cleanup", "gpt-5.4", "You clean up state."),
      null,
    );
    agents.loadAgents();

    const runningTask = agents.registerTask("cleanup-agent", "Still running", "web");
    const completedTask = agents.registerTask("cleanup-agent", "Already finished", "telegram");
    agents.completeTask(completedTask.taskId, "done");

    const db = dbModule.getDb();
    db.prepare(`
      INSERT INTO agent_tasks (task_id, agent_slug, description, status, result, origin_channel)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runningTask.taskId, "cleanup-agent", "Still running", "running", null, "web");
    db.prepare(`
      INSERT INTO agent_tasks (task_id, agent_slug, description, status, result, origin_channel, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(completedTask.taskId, "cleanup-agent", "Already finished", "completed", "done", "telegram");

    const tools = toolsModule.createTools({
      client: { listModels: async () => [] },
      onAgentTaskComplete: () => {},
    });
    const fireAgent = tools.find((tool: { name: string; handler: (args: { slug: string; }) => Promise<string>; }) => tool.name === "fire_agent");

    assert.ok(fireAgent);

    const result = await fireAgent.handler({ slug: "cleanup-agent" });

    assert.equal(result, "Agent @cleanup-agent removed.");
    assert.equal(agents.getActiveTasks().filter((task: { agentSlug: string; }) => task.agentSlug === "cleanup-agent").length, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM agent_tasks WHERE agent_slug = ?").get("cleanup-agent") as { count: number }).count,
      0,
    );

    assert.equal(
      agents.createAgentFile("cleanup-agent", "Cleanup Agent", "Handles cleanup", "gpt-5.4", "Fresh state."),
      null,
    );
    agents.loadAgents();

    const rosterEntry = agents.getAgentStatusRoster().find((agent: { slug: string; }) => agent.slug === "cleanup-agent");
    assert.ok(rosterEntry);
    assert.deepEqual(rosterEntry.runningTasks, []);
    assert.deepEqual(rosterEntry.recentTasks, []);
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});
