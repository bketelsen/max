import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function templatePath(): string {
  return resolve(__dirname, "..", "scripts", "max.service.template");
}

function unitPath(): string {
  return join(homedir(), ".config", "systemd", "user", "max.service");
}

function resolveMaxBin(): string {
  // Prefer `which max` — finds the installed binary regardless of how this
  // subcommand was invoked (tsx, compiled, npm link, npm install -g).
  const which = spawnSync("which", ["max"], { encoding: "utf-8" });
  const found = which.stdout?.trim();
  if (which.status === 0 && found) return found;
  // Fallback: the entrypoint that invoked us
  return process.argv[1];
}

function ensureLinux(): void {
  if (process.platform !== "linux") {
    console.error(
      `max service is currently Linux-only (detected: ${process.platform}).`
    );
    console.error(
      "macOS (launchd) and Windows support are not yet implemented."
    );
    process.exit(1);
  }
}

type SystemctlOpts = { ignoreFailure?: boolean };

function systemctl(args: string[], opts: SystemctlOpts = {}): number {
  const result = spawnSync("systemctl", args, { stdio: "inherit" });
  if (result.error) {
    console.error(`Failed to run systemctl: ${result.error.message}`);
    console.error("Is systemd installed and in your PATH?");
    process.exit(1);
  }
  const code = result.status ?? 1;
  if (code !== 0 && !opts.ignoreFailure) {
    process.exit(code);
  }
  return code;
}

export async function installService(): Promise<void> {
  ensureLinux();

  const tpl = templatePath();
  if (!existsSync(tpl)) {
    console.error(`Template not found at ${tpl}`);
    console.error("Reinstall Max or run from a checkout that includes scripts/.");
    process.exit(1);
  }

  const template = readFileSync(tpl, "utf-8");
  const bin = resolveMaxBin();
  const home = homedir();
  const path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";

  const unit = template
    .replaceAll("__MAX_BIN__", bin)
    .replaceAll("__HOME__", home)
    .replaceAll("__PATH__", path);

  const out = unitPath();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, unit, { mode: 0o644 });
  console.log(`Wrote ${out}`);
  console.log(`ExecStart=${bin} start`);

  systemctl(["--user", "daemon-reload"]);
  systemctl(["--user", "enable", "--now", "max.service"]);

  const user = process.env.USER || "$USER";
  console.log(
    [
      "",
      "Max service installed and started.",
      "",
      "  Status:  max service status",
      "  Logs:    journalctl --user -u max -f",
      "  Stop:    systemctl --user stop max",
      "",
      "For Max to keep running after logout and across reboots, run once:",
      `    sudo loginctl enable-linger ${user}`,
      "",
    ].join("\n")
  );
}

export async function uninstallService(): Promise<void> {
  ensureLinux();

  const out = unitPath();
  systemctl(["--user", "disable", "--now", "max.service"], {
    ignoreFailure: true,
  });

  if (existsSync(out)) {
    unlinkSync(out);
    console.log(`Removed ${out}`);
  } else {
    console.log(`No unit file at ${out} — already uninstalled?`);
  }

  systemctl(["--user", "daemon-reload"]);
  console.log("Max service uninstalled.");
}

export async function serviceStatus(): Promise<void> {
  ensureLinux();

  const result = spawnSync(
    "systemctl",
    ["--user", "status", "max.service", "--no-pager"],
    { stdio: "inherit" }
  );
  if (result.error) {
    console.error(`Failed to run systemctl: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

export function printServiceHelp(): void {
  console.log(
    `
max service — manage Max as a systemd user service (Linux)

Usage:
  max service <subcommand>

Subcommands:
  install     Install and start the service
  uninstall   Stop and remove the service
  status      Show service status and recent logs

For reboot persistence without login, run once:
  sudo loginctl enable-linger $USER
`.trim()
  );
}
