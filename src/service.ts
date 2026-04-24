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

  const envFile = join(home, ".max", ".env");

  const unit = template
    .replaceAll("__MAX_BIN__", bin)
    .replaceAll("__HOME__", home)
    .replaceAll("__PATH__", path)
    .replaceAll("__ENV_FILE__", envFile);

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
  install                Install and start the Max daemon service
  uninstall              Stop and remove the daemon service
  status                 Show daemon service status and recent logs
  install-housekeeping   Install nightly housekeeping timer
  uninstall-housekeeping Remove housekeeping timer and service
  status-housekeeping    Show housekeeping timer status
  logs-housekeeping      View recent housekeeping logs
  install-reflect        Install nightly reflection timer
  uninstall-reflect      Remove reflection timer and service
  status-reflect         Show reflection timer status
  logs-reflect           View recent reflection logs
  install-evolve         Install nightly evolve timer (4 AM)
  uninstall-evolve       Remove evolve timer and service
  status-evolve          Show evolve timer status
  logs-evolve            View recent evolve logs

For reboot persistence without login, run once:
  sudo loginctl enable-linger $USER
`.trim()
  );
}

// ---------------------------------------------------------------------------
// Housekeeping timer management
// ---------------------------------------------------------------------------

function housekeepingTimerPath(): string {
  return join(homedir(), ".config", "systemd", "user", "max-housekeeping.timer");
}

function housekeepingServicePath(): string {
  return join(homedir(), ".config", "systemd", "user", "max-housekeeping.service");
}

function generateHousekeepingTimer(): string {
  return `[Unit]
Description=Max Housekeeping Timer
Requires=max.service

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
`;
}

function generateHousekeepingService(): string {
  const bin = resolveMaxBin();
  const home = homedir();
  const path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const envFile = join(home, ".max", ".env");

  return `[Unit]
Description=Max Housekeeping Task
After=max.service

[Service]
Type=oneshot
ExecStart=${bin} housekeeping
WorkingDirectory=${home}
Environment=PATH=${path}
Environment=HOME=${home}
EnvironmentFile=-${envFile}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=max-housekeeping
`;
}

export async function installHousekeepingTimer(): Promise<void> {
  ensureLinux();

  const timerPath = housekeepingTimerPath();
  const servicePath = housekeepingServicePath();

  mkdirSync(dirname(timerPath), { recursive: true });

  writeFileSync(timerPath, generateHousekeepingTimer(), { mode: 0o644 });
  console.log(`Wrote ${timerPath}`);

  writeFileSync(servicePath, generateHousekeepingService(), { mode: 0o644 });
  console.log(`Wrote ${servicePath}`);

  systemctl(["--user", "daemon-reload"]);
  systemctl(["--user", "enable", "--now", "max-housekeeping.timer"]);

  console.log(
    [
      "",
      "Housekeeping timer installed and started.",
      "",
      "  Runs daily at 3:00 AM",
      "  Status:  max service status-housekeeping",
      "  Logs:    max service logs-housekeeping",
      "  Manual:  max housekeeping",
      "  Dry run: max housekeeping --dry-run",
      "",
    ].join("\n")
  );
}

export async function uninstallHousekeepingTimer(): Promise<void> {
  ensureLinux();

  systemctl(["--user", "disable", "--now", "max-housekeeping.timer"], {
    ignoreFailure: true,
  });

  const timerPath = housekeepingTimerPath();
  const servicePath = housekeepingServicePath();

  for (const path of [timerPath, servicePath]) {
    if (existsSync(path)) {
      unlinkSync(path);
      console.log(`Removed ${path}`);
    }
  }

  systemctl(["--user", "daemon-reload"]);
  console.log("Housekeeping timer uninstalled.");
}

export async function housekeepingStatus(): Promise<void> {
  ensureLinux();

  // Show timer status
  const result = spawnSync(
    "systemctl",
    ["--user", "list-timers", "max-housekeeping.timer", "--no-pager"],
    { stdio: "inherit" }
  );
  if (result.error) {
    console.error(`Failed to run systemctl: ${result.error.message}`);
    process.exit(1);
  }

  // Also show service status
  console.log("");
  spawnSync(
    "systemctl",
    ["--user", "status", "max-housekeeping.service", "--no-pager"],
    { stdio: "inherit" }
  );
}

export async function housekeepingLogs(): Promise<void> {
  ensureLinux();

  const result = spawnSync(
    "journalctl",
    ["--user", "-u", "max-housekeeping.service", "--no-pager", "-n", "50"],
    { stdio: "inherit" }
  );
  if (result.error) {
    console.error(`Failed to run journalctl: ${result.error.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Reflection timer management
// ---------------------------------------------------------------------------

function reflectTimerPath(): string {
  return join(homedir(), ".config", "systemd", "user", "max-reflect.timer");
}

function reflectServicePath(): string {
  return join(homedir(), ".config", "systemd", "user", "max-reflect.service");
}

function generateReflectTimer(): string {
  const tplPath = resolve(__dirname, "..", "scripts", "max-reflect.timer.template");
  if (existsSync(tplPath)) return readFileSync(tplPath, "utf-8");
  return `[Unit]
Description=Max Reflection Timer — nightly conversation mining
Requires=max.service

[Timer]
OnCalendar=*-*-* 05:00:00
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
`;
}

function generateReflectService(): string {
  const bin = resolveMaxBin();
  const home = homedir();
  const path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const envFile = join(home, ".max", ".env");

  const tplPath = resolve(__dirname, "..", "scripts", "max-reflect.service.template");
  if (existsSync(tplPath)) {
    return readFileSync(tplPath, "utf-8")
      .replaceAll("__MAX_BIN__", bin)
      .replaceAll("__HOME__", home)
      .replaceAll("__PATH__", path)
      .replaceAll("__ENV_FILE__", envFile);
  }

  return `[Unit]
Description=Max Reflection Task — mine conversations and update memory
After=max.service

[Service]
Type=oneshot
ExecStart=${bin} reflect
WorkingDirectory=${home}
Environment=PATH=${path}
Environment=HOME=${home}
EnvironmentFile=-${envFile}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=max-reflect
TimeoutStartSec=300
`;
}

export async function installReflectTimer(): Promise<void> {
  ensureLinux();

  const timerPath = reflectTimerPath();
  const servicePath = reflectServicePath();

  mkdirSync(dirname(timerPath), { recursive: true });

  writeFileSync(timerPath, generateReflectTimer(), { mode: 0o644 });
  console.log(`Wrote ${timerPath}`);

  writeFileSync(servicePath, generateReflectService(), { mode: 0o644 });
  console.log(`Wrote ${servicePath}`);

  systemctl(["--user", "daemon-reload"]);
  systemctl(["--user", "enable", "--now", "max-reflect.timer"]);

  console.log(
    [
      "",
      "Reflection timer installed and started.",
      "",
      "  Runs daily at 5:00 AM (after housekeeping at 3 AM)",
      "  Status:  max service status-reflect",
      "  Logs:    max service logs-reflect",
      "  Manual:  max reflect",
      "  Dry run: max reflect --dry-run",
      "",
    ].join("\n")
  );
}

export async function uninstallReflectTimer(): Promise<void> {
  ensureLinux();

  systemctl(["--user", "disable", "--now", "max-reflect.timer"], {
    ignoreFailure: true,
  });

  const timerPath = reflectTimerPath();
  const servicePath = reflectServicePath();

  for (const p of [timerPath, servicePath]) {
    if (existsSync(p)) {
      unlinkSync(p);
      console.log(`Removed ${p}`);
    }
  }

  systemctl(["--user", "daemon-reload"]);
  console.log("Reflection timer uninstalled.");
}

export async function reflectStatus(): Promise<void> {
  ensureLinux();

  const result = spawnSync(
    "systemctl",
    ["--user", "list-timers", "max-reflect.timer", "--no-pager"],
    { stdio: "inherit" }
  );
  if (result.error) {
    console.error(`Failed to run systemctl: ${result.error.message}`);
    process.exit(1);
  }

  console.log("");
  spawnSync(
    "systemctl",
    ["--user", "status", "max-reflect.service", "--no-pager"],
    { stdio: "inherit" }
  );
}

export async function reflectLogs(): Promise<void> {
  ensureLinux();

  const result = spawnSync(
    "journalctl",
    ["--user", "-u", "max-reflect.service", "--no-pager", "-n", "50"],
    { stdio: "inherit" }
  );
  if (result.error) {
    console.error(`Failed to run journalctl: ${result.error.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Evolve timer management
// ---------------------------------------------------------------------------

function evolveTimerPath(): string {
  return join(homedir(), ".config", "systemd", "user", "max-evolve.timer");
}

function evolveServicePath(): string {
  return join(homedir(), ".config", "systemd", "user", "max-evolve.service");
}

function generateEvolveTimer(): string {
  return `[Unit]
Description=Max Evolution Timer
Requires=max.service

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
`;
}

function generateEvolveService(): string {
  const bin = resolveMaxBin();
  const home = homedir();
  const path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const envFile = join(home, ".max", ".env");

  return `[Unit]
Description=Max Evolution Task — audit memory architecture
After=max.service

[Service]
Type=oneshot
ExecStart=${bin} evolve
WorkingDirectory=${home}
Environment=PATH=${path}
Environment=HOME=${home}
EnvironmentFile=-${envFile}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=max-evolve
TimeoutStartSec=300
`;
}

export async function installEvolveTimer(): Promise<void> {
  ensureLinux();

  const timerPath = evolveTimerPath();
  const servicePath = evolveServicePath();

  mkdirSync(dirname(timerPath), { recursive: true });

  writeFileSync(timerPath, generateEvolveTimer(), { mode: 0o644 });
  console.log(`Wrote ${timerPath}`);

  writeFileSync(servicePath, generateEvolveService(), { mode: 0o644 });
  console.log(`Wrote ${servicePath}`);

  systemctl(["--user", "daemon-reload"]);
  systemctl(["--user", "enable", "--now", "max-evolve.timer"]);

  console.log(
    [
      "",
      "Evolution timer installed and started.",
      "",
      "  Runs daily at 4:00 AM (after housekeeping at 3 AM, before reflect at 5 AM)",
      "  Status:  max service status-evolve",
      "  Logs:    max service logs-evolve",
      "  Manual:  max evolve",
      "  Dry run: max evolve --dry-run",
      "",
    ].join("\n")
  );
}

export async function uninstallEvolveTimer(): Promise<void> {
  ensureLinux();

  systemctl(["--user", "disable", "--now", "max-evolve.timer"], {
    ignoreFailure: true,
  });

  const timerPath = evolveTimerPath();
  const servicePath = evolveServicePath();

  for (const p of [timerPath, servicePath]) {
    if (existsSync(p)) {
      unlinkSync(p);
      console.log(`Removed ${p}`);
    }
  }

  systemctl(["--user", "daemon-reload"]);
  console.log("Evolution timer uninstalled.");
}

export async function evolveStatus(): Promise<void> {
  ensureLinux();

  const result = spawnSync(
    "systemctl",
    ["--user", "list-timers", "max-evolve.timer", "--no-pager"],
    { stdio: "inherit" }
  );
  if (result.error) {
    console.error(`Failed to run systemctl: ${result.error.message}`);
    process.exit(1);
  }

  console.log("");
  spawnSync(
    "systemctl",
    ["--user", "status", "max-evolve.service", "--no-pager"],
    { stdio: "inherit" }
  );
}

export async function evolveLogs(): Promise<void> {
  ensureLinux();

  const result = spawnSync(
    "journalctl",
    ["--user", "-u", "max-evolve.service", "--no-pager", "-n", "50"],
    { stdio: "inherit" }
  );
  if (result.error) {
    console.error(`Failed to run journalctl: ${result.error.message}`);
    process.exit(1);
  }
}
