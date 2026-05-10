function flag(key: string, defaultValue = true): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return val === "true" || val === "1";
}

export const flags = {
  // Listeners
  deploymentListener: flag("ENABLE_DEPLOYMENT_LISTENER", true),
  factoryListener: flag("ENABLE_FACTORY_LISTENER", true),

  // Detector groups
  vulnDetectors: flag("ENABLE_VULN_DETECTORS", true),
  sniper: flag("ENABLE_SNIPER", true),

  // Arb
  arbScanner: flag("ENABLE_ARB_SCANNER", true),

  // Execution
  executor: flag("ENABLE_EXECUTOR", true),
};

export function printFlags() {
  console.log("Feature flags:");
  for (const [key, val] of Object.entries(flags)) {
    console.log(`  ${key}: ${val ? "ON" : "OFF"}`);
  }
  console.log("");
}
