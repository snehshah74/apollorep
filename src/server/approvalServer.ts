// Express server that exposes the approval queue as a REST API and serves the approval UI.
// The human-in-the-loop interface — reps review, approve, or reject queued agent actions here.
// All mutations go through the trust model's logAction for a complete audit trail.

import express from "express";
import cors from "cors";
import * as path from "path";
import * as dotenv from "dotenv";

import {
  getQueue,
  getPending,
  approveAction,
  rejectAction,
} from "../trust/approvalQueue";
import { sendEmail } from "../tools/emailSender";
import { runPipeline } from "../agents/orchestrator";
import {
  getTrustLevel,
  getTrustLevelDescription,
  ACTION_POLICIES,
  logAction,
} from "../trust/trustModel";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../../public")));

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

// GET /api/queue — all actions with trust level context
app.get("/api/queue", async (_req, res) => {
  try {
    const actions = await getQueue();
    const trustLevel = getTrustLevel();
    res.json({
      trustLevel,
      trustDescription: getTrustLevelDescription(trustLevel),
      actions,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/queue/pending — only pending actions
app.get("/api/queue/pending", async (_req, res) => {
  try {
    const actions = await getPending();
    res.json({ actions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/approve/:id — approve and execute an action
app.post("/api/approve/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const action = await approveAction(id);

    if (!action) {
      res.status(404).json({ error: `Action ${id} not found` });
      return;
    }

    let result = "Approved but no execution handler matched";

    if (action.action === "send_cold_email") {
      const p = action.payload as {
        contactEmail: string;
        subject: string;
        htmlBody: string;
      };
      const sent = await sendEmail(p.contactEmail, p.subject, p.htmlBody, id);
      result = sent ? "Cold email sent successfully" : "Cold email send failed";
    } else if (action.action === "send_daily_brief") {
      const p = action.payload as { briefHtml: string };
      const repEmail = process.env.REP_EMAIL || "rep@yourcompany.com";
      const sent = await sendEmail(
        repEmail,
        `ApolloRep Daily Brief — ${new Date().toLocaleDateString()}`,
        p.briefHtml,
        id
      );
      result = sent ? "Daily brief sent successfully" : "Daily brief send failed";
    }

    const trustLevel = getTrustLevel();
    await logAction(action.action, trustLevel, true, action.payload, result);

    console.log(
      `[${timestamp()}] [ApprovalServer] Approved | id: ${id} | result: ${result}`
    );
    res.json({ success: true, action, result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/reject/:id — reject an action with optional notes
app.post("/api/reject/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const notes: string = req.body?.notes || "";

    const action = await rejectAction(id, notes);

    if (!action) {
      res.status(404).json({ error: `Action ${id} not found` });
      return;
    }

    const trustLevel = getTrustLevel();
    await logAction(action.action, trustLevel, false, action.payload, `Rejected: ${notes}`);

    console.log(
      `[${timestamp()}] [ApprovalServer] Rejected | id: ${id} | notes: "${notes}"`
    );
    res.json({ success: true, action });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/audit — last 50 audit entries
app.get("/api/audit", async (_req, res) => {
  try {
    const fs = await import("fs");
    const auditPath = path.join(__dirname, "../data/auditLog.json");
    let entries: unknown[] = [];
    if (fs.existsSync(auditPath)) {
      const raw = fs.readFileSync(auditPath, "utf-8").trim();
      entries = raw ? JSON.parse(raw) : [];
    }
    res.json({ entries: entries.slice(-50).reverse() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/trust — trust level config and action policies
app.get("/api/trust", (_req, res) => {
  try {
    const level = getTrustLevel();
    res.json({
      level,
      description: getTrustLevelDescription(level),
      actionPolicies: ACTION_POLICIES,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/pipeline/run — trigger pipeline from UI (fire and forget)
app.post("/api/pipeline/run", (_req, res) => {
  res.json({ success: true, message: "Pipeline started" });
  runPipeline().catch((err) => {
    console.error(`[${timestamp()}] [ApprovalServer] Pipeline run error:`, err);
  });
});

// GET /health — Railway healthcheck
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// GET / — serve approval UI
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../../public/approval.html"));
});

const PORT = parseInt(process.env.PORT || "3000", 10);

export function startServer(): void {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[${timestamp()}] [ApprovalServer] Server running at http://0.0.0.0:${PORT}`
    );
    console.log(
      `[${timestamp()}] [ApprovalServer] Approval UI: http://localhost:${PORT}/`
    );
    console.log(
      `[${timestamp()}] [ApprovalServer] API base:    http://localhost:${PORT}/api`
    );
  });
}

// Allow direct execution
if (require.main === module) {
  startServer();
}

export default app;
