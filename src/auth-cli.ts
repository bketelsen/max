import { createInterface } from "readline";
import qrcode from "qrcode-terminal";
import { getDb } from "./store/db.js";
import {
  isAuthConfigured,
  getAuthMethods,
  getPasskeys,
  clearAllAuth,
  setTotpSecret,
  getTotpSecret,
} from "./store/db.js";
import { generateTotpSetup, verifyTotpWithSecret } from "./api/auth.js";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function setupTotp(): Promise<void> {
  console.log();
  console.log(`${BOLD}TOTP Setup${RESET}`);
  console.log(`${DIM}Configure a time-based one-time password for LAN authentication.${RESET}`);
  console.log();

  const existing = getTotpSecret();
  if (existing) {
    const overwrite = await prompt(`${YELLOW}TOTP is already configured. Overwrite? (y/N): ${RESET}`);
    if (overwrite.toLowerCase() !== "y") {
      console.log("Keeping existing TOTP configuration.");
      return;
    }
  }

  const { secret, uri } = generateTotpSetup();

  console.log("Scan this QR code with your authenticator app:\n");
  qrcode.generate(uri, { small: true });
  console.log();
  console.log(`${DIM}Manual entry: ${secret}${RESET}`);
  console.log();

  // Verify before saving
  const code = await prompt("Enter the 6-digit code from your app to verify: ");
  if (!verifyTotpWithSecret(code, secret)) {
    console.log(`${RED}✗ Invalid code. TOTP not saved. Try again.${RESET}`);
    process.exit(1);
  }

  setTotpSecret(secret);
  console.log(`${GREEN}✓ TOTP configured successfully!${RESET}`);
}

function showStatus(): void {
  // Initialize DB so tables exist
  getDb();
  const configured = isAuthConfigured();
  const methods = getAuthMethods();
  const passkeys = getPasskeys();

  console.log();
  console.log(`${BOLD}Auth Status${RESET}`);
  console.log();
  console.log(`  Configured: ${configured ? `${GREEN}Yes${RESET}` : `${DIM}No${RESET}`}`);
  console.log(`  TOTP:       ${methods.includes("totp") ? `${GREEN}Enabled${RESET}` : `${DIM}Not set${RESET}`}`);
  console.log(`  Passkeys:   ${passkeys.length > 0 ? `${GREEN}${passkeys.length} registered${RESET}` : `${DIM}None${RESET}`}`);
  if (passkeys.length > 0) {
    for (const pk of passkeys) {
      console.log(`              ${DIM}• ${pk.credential_id.slice(0, 16)}… (${pk.created_at})${RESET}`);
    }
  }
  console.log();
  if (!configured) {
    console.log(`${DIM}Run 'max auth setup' to configure authentication.${RESET}`);
    console.log(`${DIM}Register passkeys from the web UI at http://localhost:7777${RESET}`);
  }
  console.log();
}

async function resetAuth(): Promise<void> {
  // Initialize DB
  getDb();
  if (!isAuthConfigured()) {
    console.log("No auth configuration found. Nothing to reset.");
    return;
  }

  const confirm = await prompt(`${RED}${BOLD}This will remove ALL auth config (TOTP + passkeys + sessions). Continue? (y/N): ${RESET}`);
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }

  clearAllAuth();
  console.log(`${GREEN}✓ All auth configuration cleared.${RESET}`);
}

function printAuthHelp(): void {
  console.log(`
${BOLD}max auth${RESET} — Manage authentication for LAN access

${BOLD}Commands:${RESET}
  max auth setup    Configure TOTP (generates QR code for authenticator app)
  max auth status   Show current auth configuration
  max auth reset    Remove all auth config (TOTP, passkeys, sessions)

${DIM}Passkeys are registered from the web UI at http://localhost:7777${RESET}
`.trim());
}

export async function runAuthCli(args: string[]): Promise<void> {
  const sub = args[0];

  // Ensure DB is initialized for all subcommands
  getDb();

  switch (sub) {
    case "setup":
      await setupTotp();
      break;
    case "status":
      showStatus();
      break;
    case "reset":
      await resetAuth();
      break;
    default:
      printAuthHelp();
      if (sub) process.exit(1);
  }
}
