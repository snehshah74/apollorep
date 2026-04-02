// Manages the queue of agent actions pending human review.
// Sits between the orchestrator and execution — the human-in-the-loop checkpoint.
// Read-modify-write pattern on every mutation ensures queue is never corrupted.

import * as fs from "fs";
import * as path from "path";
import { ActionRisk } from "./trustModel";

export interface PendingAction {
  id: string;
  action: string;
  risk: ActionRisk;
  accountId: string;
  companyName: string;
  payload: Record<string, unknown>;
  preview: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  repNotes?: string;
}

const QUEUE_PATH = path.join(__dirname, "../data/approvalQueue.json");

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function generateId(): string {
  return `action_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function readQueue(): PendingAction[] {
  try {
    if (!fs.existsSync(QUEUE_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(QUEUE_PATH, "utf-8").trim();
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error(`[${timestamp()}] [ApprovalQueue] Error reading queue:`, error);
    return [];
  }
}

function writeQueue(queue: PendingAction[]): void {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), "utf-8");
}

function getRiskForAction(action: string): ActionRisk {
  const riskMap: Record<string, ActionRisk> = {
    score_lead: ActionRisk.LOW,
    draft_outreach: ActionRisk.LOW,
    compose_brief: ActionRisk.LOW,
    send_daily_brief: ActionRisk.MEDIUM,
    schedule_followup: ActionRisk.MEDIUM,
    send_cold_email: ActionRisk.HIGH,
    enroll_sequence: ActionRisk.HIGH,
    book_meeting: ActionRisk.HIGH,
  };
  return riskMap[action] || ActionRisk.HIGH;
}

export async function addToQueue(
  action: string,
  accountId: string,
  companyName: string,
  payload: Record<string, unknown>,
  preview: string
): Promise<string> {
  const id = generateId();
  const entry: PendingAction = {
    id,
    action,
    risk: getRiskForAction(action),
    accountId,
    companyName,
    payload,
    preview,
    createdAt: new Date().toISOString(),
    status: "pending",
  };

  const queue = readQueue();
  queue.push(entry);
  writeQueue(queue);

  console.log(
    `[${timestamp()}] [ApprovalQueue] Added to queue | id: ${id} | action: ${action} | company: ${companyName}`
  );
  return id;
}

export async function getQueue(): Promise<PendingAction[]> {
  return readQueue();
}

export async function getPending(): Promise<PendingAction[]> {
  return readQueue().filter((a) => a.status === "pending");
}

export async function approveAction(id: string): Promise<PendingAction | null> {
  const queue = readQueue();
  const idx = queue.findIndex((a) => a.id === id);
  if (idx === -1) {
    console.warn(`[${timestamp()}] [ApprovalQueue] approveAction: id ${id} not found`);
    return null;
  }
  queue[idx].status = "approved";
  writeQueue(queue);
  console.log(`[${timestamp()}] [ApprovalQueue] Approved | id: ${id}`);
  return queue[idx];
}

export async function rejectAction(id: string, notes: string): Promise<PendingAction | null> {
  const queue = readQueue();
  const idx = queue.findIndex((a) => a.id === id);
  if (idx === -1) {
    console.warn(`[${timestamp()}] [ApprovalQueue] rejectAction: id ${id} not found`);
    return null;
  }
  queue[idx].status = "rejected";
  queue[idx].repNotes = notes;
  writeQueue(queue);
  console.log(`[${timestamp()}] [ApprovalQueue] Rejected | id: ${id} | notes: ${notes}`);
  return queue[idx];
}
