import { readFileSync } from "node:fs";
import path from "node:path";

export function readGeminiKey(): string {
  let text = "";
  try {
    text = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  } catch {
    throw new Error("Could not read .env.local, so there is no Gemini key.");
  }
  const line = text.split(/\r?\n/).find((entry) => /^\s*GEMINI_API_KEY\s*=/.test(entry));
  const key = line?.slice(line.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env.local.");
  return key;
}
