export { Pipeline, formatResult } from "./pipeline.js";
export type { PipelineResult } from "./pipeline.js";
export type { Detector, DetectorContext, Finding, Severity } from "./types.js";

// Detectors
export { proxyDetector } from "./proxy-detector.js";
export { initializerDetector } from "./initializer-detector.js";
export { openWithdrawalDetector } from "./open-withdrawal-detector.js";
export { ownershipDetector } from "./ownership-detector.js";
export { valueDetector } from "./value-detector.js";
export { honeypotDetector } from "./honeypot-detector.js";
