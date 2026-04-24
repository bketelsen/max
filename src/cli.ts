#!/usr/bin/env node

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  const version = getVersion();
  console.log(`
max v${version} — AI orchestrator powered by Copilot SDK

Usage:
  max <command>

Commands:
  start       Start the Max daemon (Telegram bot + HTTP API)
  tui         Connect to the daemon via terminal UI
  setup       Interactive first-run configuration
  auth        Manage TOTP/Passkey authentication for LAN access
  service     Install/manage Max as a systemd user service (Linux)
  update      Check for updates and install the latest version
  help        Show this help message

Flags (start):
  --self-edit Allow Max to modify his own source code (off by default)

Examples:
  max start              Start the daemon
  max start --self-edit  Start with self-edit enabled
  max tui                Open the terminal client
  max setup              Configure Telegram token and settings
  max service install    Run Max as an always-on systemd service
`.trim());
}

const args = process.argv.slice(2);
const command = args[0] || "help";

switch (command) {
  case "start": {
    // Parse flags for start command
    const startFlags = args.slice(1);
    if (startFlags.includes("--self-edit")) {
      process.env.MAX_SELF_EDIT = "1";
    }
    await import("./daemon.js");
    break;
  }
  case "tui":
    await import("./tui/index.js");
    break;
  case "setup":
    await import("./setup.js");
    break;
  case "auth": {
    const { runAuthCli } = await import("./auth-cli.js");
    await runAuthCli(args.slice(1));
    break;
  }
  case "service": {
    const { installService, uninstallService, serviceStatus, printServiceHelp } =
      await import("./service.js");
    const sub = args[1];
    if (sub === "install") {
      await installService();
    } else if (sub === "uninstall") {
      await uninstallService();
    } else if (sub === "status") {
      await serviceStatus();
    } else {
      printServiceHelp();
      if (sub) process.exit(1);
    }
    break;
  }
  case "update": {
    const { checkForUpdate, performUpdate } = await import("./update.js");
    const check = await checkForUpdate();
    if (!check.checkSucceeded) {
      console.error("⚠ Could not reach the npm registry. Check your network and try again.");
      process.exit(1);
    }
    if (!check.updateAvailable) {
      console.log(`max v${check.current} is already the latest version.`);
      break;
    }
    console.log(`Update available: v${check.current} → v${check.latest}`);
    console.log("Installing...");
    const result = await performUpdate();
    if (result.ok) {
      console.log(`✅ Updated to v${check.latest}`);
    } else {
      console.error(`❌ Update failed: ${result.output}`);
      process.exit(1);
    }
    break;
  }
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "--version":
  case "-v":
    console.log(getVersion());
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}
