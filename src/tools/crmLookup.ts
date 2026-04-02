// Simulates a CRM lookup to pull enriched account data into the pipeline.
// Provides the lead scorer and outreach drafter with contact and company context.
// Abstracts CRM vendor behind a single interface so swapping Salesforce → HubSpot is one file change.

import * as fs from "fs";
import * as path from "path";

export interface Contact {
  name: string;
  title: string;
  email: string;
  linkedin: string;
}

export interface Account {
  id: string;
  company: string;
  domain: string;
  industry: string;
  employees: number;
  annualRevenue: string;
  mainContact: Contact;
  icpScore: number;
  currentStack: string[];
  lastContactedDaysAgo: number | null;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export async function lookupAccount(id: string): Promise<Account | null> {
  // Simulate CRM API response latency
  await new Promise((resolve) => setTimeout(resolve, 200));

  try {
    const accountsPath = path.join(__dirname, "../data/accounts.json");
    const raw = fs.readFileSync(accountsPath, "utf-8");
    const accounts: Account[] = JSON.parse(raw);
    const account = accounts.find((a) => a.id === id) || null;
    console.log(
      `[${timestamp()}] [CRMLookup] CRM lookup for ${id}: ${account ? "found" : "not found"}`
    );
    return account;
  } catch (error) {
    console.error(
      `[${timestamp()}] [CRMLookup] Error looking up account ${id}:`,
      error
    );
    return null;
  }

  // PRODUCTION_EXTENSION: In production this would call the Salesforce REST API
  // or HubSpot CRM API to get live account data including recent activity, open
  // opportunities, and engagement history. OAuth tokens would be managed via a
  // secrets manager and refreshed automatically on expiry.
}

export async function loadAllAccounts(): Promise<Account[]> {
  try {
    const accountsPath = path.join(__dirname, "../data/accounts.json");
    const raw = fs.readFileSync(accountsPath, "utf-8");
    return JSON.parse(raw) as Account[];
  } catch (error) {
    console.error(`[${timestamp()}] [CRMLookup] Error loading all accounts:`, error);
    return [];
  }
}
