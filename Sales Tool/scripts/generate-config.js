const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_ENV_VARS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

function readEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

const missingVars = REQUIRED_ENV_VARS.filter((name) => !readEnv(name));

if (missingVars.length > 0) {
  console.error(`[generate-config] Missing required env vars: ${missingVars.join(", ")}`);
  process.exit(1);
}

const config = {
  SUPABASE_URL: readEnv("SUPABASE_URL"),
  SUPABASE_ANON_KEY: readEnv("SUPABASE_ANON_KEY"),
};

const outputPath = path.resolve(process.cwd(), "config.js");
const outputContent = `window.__APP_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;

fs.writeFileSync(outputPath, outputContent, "utf8");
console.log(`[generate-config] Wrote ${outputPath}`);
