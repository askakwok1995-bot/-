const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_ENV_VARS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

function readEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function assertRequiredEnv() {
  const missingVars = REQUIRED_ENV_VARS.filter((name) => !readEnv(name));
  if (missingVars.length > 0) {
    console.error(`[generate-config] Missing required env vars: ${missingVars.join(", ")}`);
    process.exit(1);
  }
}

function buildConfigObject() {
  return {
    SUPABASE_URL: readEnv("SUPABASE_URL"),
    SUPABASE_ANON_KEY: readEnv("SUPABASE_ANON_KEY"),
  };
}

function parseOutputPath() {
  const args = process.argv.slice(2);
  const outFlagIndex = args.indexOf("--out");
  if (outFlagIndex >= 0 && args[outFlagIndex + 1]) {
    return path.resolve(process.cwd(), args[outFlagIndex + 1]);
  }
  return path.resolve(process.cwd(), "config.js");
}

function writeConfigFile(outputPath) {
  assertRequiredEnv();
  const config = buildConfigObject();
  const outputContent = `window.__APP_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;
  fs.writeFileSync(outputPath, outputContent, "utf8");
  return outputPath;
}

function main() {
  const outputPath = parseOutputPath();
  const wrotePath = writeConfigFile(outputPath);
  console.log(`[generate-config] Wrote ${wrotePath}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_ENV_VARS,
  readEnv,
  buildConfigObject,
  writeConfigFile,
};
