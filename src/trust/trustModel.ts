// Implements the progressive autonomy model — the core product differentiator.
// Determines which actions require human approval based on risk level and current trust level.
// Audit logging is co-located here so every trust decision leaves a permanent trace.

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

export enum TrustLevel {
  SUPERVISED = 1,      // All actions need human approval
  SEMI_AUTONOMOUS = 2, // Low-risk actions auto-approved
  AUTONOMOUS = 3,      // All actions within policy run automatically
}

export enum ActionRisk {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export interface ActionPolicy {
  action: string;
  risk: ActionRisk;
  description: string;
}

export const ACTION_POLICIES: ActionPolicy[] = [
  { action: "score_lead",        risk: ActionRisk.LOW,    description: "Score and rank a lead" },
  { action: "draft_outreach",    risk: ActionRisk.LOW,    description: "Draft email copy" },
  { action: "compose_brief",     risk: ActionRisk.LOW,    description: "Compose daily brief" },
  { action: "send_daily_brief",  risk: ActionRisk.MEDIUM, description: "Send brief to rep" },
  { action: "schedule_followup", risk: ActionRisk.MEDIUM, description: "Schedule a follow-up task" },
  { action: "send_cold_email",   risk: ActionRisk.HIGH,   description: "Send cold email to prospect" },
  { action: "enroll_sequence",   risk: ActionRisk.HIGH,   description: "Enroll contact in sequence" },
  { action: "book_meeting",      risk: ActionRisk.HIGH,   description: "Book a meeting on rep's behalf" },
];

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function requiresApproval(action: string, trustLevel: TrustLevel): boolean {
  const policy = ACTION_POLICIES.find((p) => p.action === action);
  if (!policy) {
    // Unknown action — default to requiring approval for safety
    console.warn(`[${timestamp()}] [TrustModel] Unknown action "${action}" — defaulting to require approval`);
    return true;
  }

  switch (trustLevel) {
    case TrustLevel.SUPERVISED:
      return true;
    case TrustLevel.SEMI_AUTONOMOUS:
      return policy.risk === ActionRisk.HIGH;
    case TrustLevel.AUTONOMOUS:
      return false;
    default:
      return true;
  }
}

export function getTrustLevel(): TrustLevel {
  const raw = process.env.TRUST_LEVEL;
  const parsed = raw ? parseInt(raw, 10) : 1;

  if (![1, 2, 3].includes(parsed)) {
    throw new Error(
      `Invalid TRUST_LEVEL "${raw}". Must be 1 (Supervised), 2 (Semi-Autonomous), or 3 (Autonomous).`
    );
  }

  return parsed as TrustLevel;
}

export function getTrustLevelDescription(level: TrustLevel): string {
  switch (level) {
    case TrustLevel.SUPERVISED:
      return "All actions require your approval before executing";
    case TrustLevel.SEMI_AUTONOMOUS:
      return "Low and medium-risk actions run automatically; high-risk actions need approval";
    case TrustLevel.AUTONOMOUS:
      return "All actions within policy execute automatically without intervention";
  }
}

interface AuditEntry {
  id: string;
  action: string;
  trustLevel: number;
  approved: boolean;
  payload: object;
  result: string;
  timestamp: string;
}

export async function logAction(
  action: string,
  trustLevel: TrustLevel,
  approved: boolean,
  payload: object,
  result: string
): Promise<void> {
  try {
    const auditPath = path.join(__dirname, "../data/auditLog.json");

    let entries: AuditEntry[] = [];
    if (fs.existsSync(auditPath)) {
      const raw = fs.readFileSync(auditPath, "utf-8").trim();
      entries = raw ? JSON.parse(raw) : [];
    }

    const entry: AuditEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      action,
      trustLevel,
      approved,
      payload,
      result,
      timestamp: new Date().toISOString(),
    };

    entries.push(entry);
    fs.writeFileSync(auditPath, JSON.stringify(entries, null, 2), "utf-8");

    console.log(
      `[${timestamp()}] [TrustModel] Audit logged | action: ${action} | approved: ${approved} | trustLevel: ${trustLevel}`
    );
  } catch (error) {
    console.error(`[${timestamp()}] [TrustModel] Failed to write audit log:`, error);
  }
}
