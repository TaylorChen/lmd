#!/usr/bin/env node

import process from "node:process";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function firstContextItem(context) {
  return Array.isArray(context?.items) && context.items.length > 0 ? context.items[0] : null;
}

const rawInput = await readStdin();
const input = JSON.parse(rawInput);
const item = firstContextItem(input.context);
const title = `${item?.name?.replace(/\.md$/i, "") ?? "workspace"} summary`;
const contextLines = Array.isArray(input.context?.items)
  ? input.context.items
      .map((entry) => `- ${entry.name} (${entry.sourceKind} / ${entry.reason}): ${entry.excerpt}`)
      .join("\n")
  : "- No context items supplied.";

process.stdout.write(
  `${JSON.stringify({
    title,
    content: `# ${title}\n\n_Provider: ${input.provider} / ${input.model}_\n\n## Summary\n\n${contextLines}\n\n## Notes\n\n- Replace this example script with a real local LLM or llm-wiki wrapper.`,
  })}\n`,
);
