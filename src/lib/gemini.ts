// Shared Gemini API client used by all agents for LLM calls.
// Centralizes model config, rate limiting, and error handling in one place.
// Single helper function keeps agents focused on prompt logic, not API plumbing.

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

let lastCallTime = 0;
const MIN_DELAY_MS = 6000; // 6s between calls = ~10 RPM, safe for free tier

function parseRetryDelay(error: unknown): number {
  try {
    const msg = String(error);
    const match = msg.match(/retryDelay['":\s]+(\d+)s/);
    if (match) return parseInt(match[1], 10) * 1000;
    const secs = msg.match(/retry in (\d+)/i);
    if (secs) return parseInt(secs[1], 10) * 1000;
  } catch {}
  return 60000; // default 60s if we can't parse
}

export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  expectJson: boolean = false
): Promise<string> {
  // Enforce minimum delay between calls
  const now = Date.now();
  const wait = MIN_DELAY_MS - (now - lastCallTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallTime = Date.now();

  const fullMessage = expectJson
    ? userMessage + "\n\nIMPORTANT: Respond with valid JSON only. No markdown, no backticks, no explanation. Raw JSON only."
    : userMessage;

  const prompt = `${systemPrompt}\n\n${fullMessage}`;
  console.log(`[${timestamp()}] [Gemini] Calling model | "${userMessage.slice(0, 60)}..."`);

  // First attempt
  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    console.log(`[${timestamp()}] [Gemini] Response received | ${response.length} chars`);
    return response;
  } catch (error: unknown) {
    const msg = String(error);
    const is429 = msg.includes("429") || msg.includes("Too Many Requests");

    if (is429) {
      const delay = parseRetryDelay(error);
      console.warn(`[${timestamp()}] [Gemini] Rate limited — waiting ${delay / 1000}s then retrying...`);
      await new Promise(r => setTimeout(r, delay + 2000)); // extra 2s buffer
      lastCallTime = Date.now();

      // Single retry after waiting
      try {
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        console.log(`[${timestamp()}] [Gemini] Retry succeeded | ${response.length} chars`);
        return response;
      } catch (retryError) {
        console.error(`[${timestamp()}] [Gemini] Retry failed:`, retryError);
        return "";
      }
    }

    console.error(`[${timestamp()}] [Gemini] Error:`, error);
    return "";
  }
}
