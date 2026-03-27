import { runAgent } from "./index";
import { parseAgentCliArgs } from "./cliOptions";

async function main() {
  const parsed = parseAgentCliArgs(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    process.stderr.write(parsed.message);
    process.exit(parsed.exitCode);
  }

  await runAgent(parsed.options);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
