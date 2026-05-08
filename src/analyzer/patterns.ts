// Common vulnerability signatures found in bytecode
// These are function selector / opcode patterns that indicate potential issues

export interface PatternMatch {
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  offset: number;
}

// 4-byte function selectors for commonly exploitable functions
const SUSPICIOUS_SELECTORS: Record<string, { name: string; severity: PatternMatch["severity"]; description: string }> = {
  // Unprotected selfdestruct
  "00f55d9d": {
    name: "unprotected-selfdestruct",
    severity: "critical",
    description: "selfdestruct with address parameter — check access control",
  },
  // approve with no checks (infinite approval patterns)
  "095ea7b3": {
    name: "approve",
    severity: "low",
    description: "Standard approve — check for approval front-running",
  },
  // mint function
  "40c10f19": {
    name: "unprotected-mint",
    severity: "high",
    description: "mint(address,uint256) — verify access control",
  },
  // setOwner without checks
  "13af4035": {
    name: "set-owner",
    severity: "high",
    description: "setOwner(address) — verify proper access control",
  },
};

// Raw opcode patterns
const OPCODE_PATTERNS: { pattern: string; name: string; severity: PatternMatch["severity"]; description: string }[] = [
  {
    // DELEGATECALL opcode
    pattern: "f4",
    name: "delegatecall",
    severity: "medium",
    description: "Uses DELEGATECALL — potential proxy or upgrade pattern, check for storage collisions",
  },
  {
    // SELFDESTRUCT opcode
    pattern: "ff",
    name: "selfdestruct",
    severity: "high",
    description: "Contains SELFDESTRUCT opcode",
  },
  {
    // CREATE2 opcode
    pattern: "f5",
    name: "create2",
    severity: "low",
    description: "Uses CREATE2 — can deploy to deterministic addresses",
  },
];

export function scanBytecode(bytecode: string): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const code = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;

  // Check for known function selectors
  for (const [selector, info] of Object.entries(SUSPICIOUS_SELECTORS)) {
    const idx = code.indexOf(selector);
    if (idx !== -1) {
      matches.push({
        ...info,
        offset: idx / 2,
      });
    }
  }

  // Check for suspicious opcode patterns
  // Note: this is naive — a proper disassembler would distinguish code from data
  for (const { pattern, name, severity, description } of OPCODE_PATTERNS) {
    const idx = code.indexOf(pattern);
    if (idx !== -1) {
      matches.push({ name, severity, description, offset: idx / 2 });
    }
  }

  return matches;
}
