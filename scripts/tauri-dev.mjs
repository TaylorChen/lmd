import { execFileSync, spawn } from "node:child_process";
import process from "node:process";

const PORT = "1420";
const projectRoot = process.cwd();
const isDryRun = process.argv.includes("--dry-run");

function tryExec(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function listListeningPids(port) {
  const output = tryExec("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function commandForPid(pid) {
  return tryExec("ps", ["-p", pid, "-o", "command="]);
}

function isProjectVite(command) {
  return command.includes(`${projectRoot}/node_modules/.bin/vite`) && command.includes(`--port ${PORT}`);
}

function stopStaleViteIfNeeded() {
  const pids = listListeningPids(PORT);
  if (pids.length === 0) {
    console.log(`[tauri:dev] Port ${PORT} is free.`);
    return;
  }

  for (const pid of pids) {
    const command = commandForPid(pid);
    if (!command) continue;

    if (!isProjectVite(command)) {
      console.error(`[tauri:dev] Port ${PORT} is used by another process: ${command}`);
      process.exit(1);
    }

    if (isDryRun) {
      console.log(`[tauri:dev] Would stop stale vite process ${pid}: ${command}`);
      continue;
    }

    console.log(`[tauri:dev] Stopping stale vite process ${pid}.`);
    process.kill(Number(pid), "SIGTERM");
  }
}

function runTauriDev() {
  if (isDryRun) {
    console.log("[tauri:dev] Dry run complete.");
    return;
  }

  const child = spawn("npm", ["run", "tauri", "dev"], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

stopStaleViteIfNeeded();
runTauriDev();
