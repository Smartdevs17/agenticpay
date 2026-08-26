import { randomUUID } from 'node:crypto';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ContractLanguage = 'solidity' | 'rust' | 'vyper' | 'javascript';

export interface AuditFinding {
  type: string;
  severity: SeverityLevel;
  line: number;
  description: string;
  recommendation: string;
  code?: string;
}

export interface AuditReport {
  reportId: string;
  overallScore: number;
  findings: AuditFinding[];
  summary: {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
    passed: boolean;
  };
  metadata: {
    language: ContractLanguage;
    linesOfCode: number;
    sourceHash: string;
    analysisDurationMs: number;
  };
  generatedAt: string;
}

export interface HistoryQuery {
  minScore?: number;
  maxScore?: number;
  language?: ContractLanguage;
  limit?: number;
  offset?: number;
}

const VULNERABILITY_PATTERNS: Array<{
  type: string;
  severity: SeverityLevel;
  patterns: RegExp[];
  description: string;
  recommendation: string;
}> = [
  {
    type: 'Reentrancy',
    severity: 'high',
    patterns: [
      /\.call\s*\{[^}]*value[^}]*\}\s*\([^)]*\)/i,
      /\.delegatecall\s*\(/i,
    ],
    description: 'External call before state update — potential reentrancy vulnerability',
    recommendation: 'Apply checks-effects-interactions pattern. Update state before making external calls.',
  },
  {
    type: 'Unchecked External Call',
    severity: 'medium',
    patterns: [
      /\.call\s*\([^)]*\)(?!\s*\.\s*require)/i,
      /\.send\s*\(/i,
      /\.transfer\s*\(/i,
    ],
    description: 'External calls should be checked for success',
    recommendation: 'Use a require statement or check the return value of external calls.',
  },
  {
    type: 'Timestamp Dependence',
    severity: 'low',
    patterns: [
      /block\.timestamp/i,
      /now\b/i,
    ],
    description: 'Using block.timestamp for critical logic — miners can manipulate timestamps',
    recommendation: 'Avoid using block.timestamp for critical state transitions. Use oracle-based timestamps.',
  },
  {
    type: 'Unchecked Return Value',
    severity: 'low',
    patterns: [
      /\.transfer\(/i,
      /\.send\(/i,
    ],
    description: 'Return value of transfer/send not checked',
    recommendation: 'Use call() with return value check instead of transfer()/send().',
  },
  {
    type: 'TX Origin Authentication',
    severity: 'medium',
    patterns: [
      /tx\.origin/i,
    ],
    description: 'Using tx.origin for authentication — vulnerable to phishing attacks',
    recommendation: 'Use msg.sender instead of tx.origin for authentication.',
  },
  {
    type: 'Integer Overflow/Underflow',
    severity: 'medium',
    patterns: [
      /\b(uint|int)\d*\s+(public\s+)?[a-z]\w*\s*[=+\\-]/i,
      /\+\+|--/,
    ],
    description: 'Unchecked arithmetic operations may overflow or underflow',
    recommendation: 'Use SafeMath library or Solidity ^0.8.0 built-in overflow checks.',
  },
  {
    type: 'Uninitialized Storage Pointer',
    severity: 'high',
    patterns: [
      /\bstruct\s+\w+\s+(public\s+)?\w+\s*;/i,
    ],
    description: 'Uninitialized storage pointers can overwrite contract state',
    recommendation: 'Initialize storage variables properly. Use appropriate data locations.',
  },
  {
    type: 'Delegatecall to Untrusted Contract',
    severity: 'critical',
    patterns: [
      /delegatecall\s*\([^)]*\)/i,
    ],
    description: 'Delegatecall to arbitrary address can lead to contract takeover',
    recommendation: 'Avoid delegatecall to user-supplied addresses. Use a whitelist of trusted implementations.',
  },
  {
    type: 'Unchecked Array Access',
    severity: 'medium',
    patterns: [
      /\[\s*msg\.sender\s*\]/i,
      /\[\s*tx\.origin\s*\]/i,
    ],
    description: 'Dynamic array access with user input can cause out-of-bounds errors',
    recommendation: 'Add bounds checking before array access.',
  },
  {
    type: 'Selfdestruct Usage',
    severity: 'high',
    patterns: [
      /selfdestruct\s*\(/i,
      /suicide\s*\(/i,
    ],
    description: 'Selfdestruct allows contract destruction and ether redirection',
    recommendation: 'Avoid selfdestruct in contracts holding user funds. Implement a multi-sig removal process.',
  },
  {
    type: 'Weak Randomness',
    severity: 'medium',
    patterns: [
      /block\.hash/i,
      /blockhash/i,
      /block\.difficulty/i,
      /block\.prevrandao/i,
    ],
    description: 'Using on-chain values for randomness — can be predicted/manipulated by miners',
    recommendation: 'Use a verifiable random function (VRF) like Chainlink VRF for randomness.',
  },
  {
    type: 'Missing Access Control',
    severity: 'high',
    patterns: [
      /\bfunction\s+\w+\s*\([^)]*\)\s*(public|external)\s*(?!.*(onlyOwner|require|auth))/i,
    ],
    description: 'Public/external function without access control',
    recommendation: 'Add access control modifiers to restrict sensitive functions.',
  },
  {
    type: 'Gas Limit Issues',
    severity: 'low',
    patterns: [
      /for\s*\([^;]*;\s*[^;]*;\s*[^)]+\)/i,
      /while\s*\(true\)/i,
    ],
    description: 'Loops over dynamic arrays may hit gas limit',
    recommendation: 'Avoid unbounded loops over dynamic data. Use paginated withdrawals.',
  },
  {
    type: 'Floating Pragma',
    severity: 'info',
    patterns: [
      /pragma\s+solidity\s+\^/i,
    ],
    description: 'Floating pragma allows compiling with unexpected compiler versions',
    recommendation: 'Lock pragma to a specific Solidity version.',
  },
  {
    type: 'Unused Variable',
    severity: 'info',
    patterns: [
      /\b(uint|int|address|bool|string)\s+\w+\s*;/,
    ],
    description: 'Declared but unused variables increase gas costs',
    recommendation: 'Remove unused variable declarations.',
  },
  {
    type: 'Hardcoded Address',
    severity: 'low',
    patterns: [
      /0x[a-fA-F0-9]{40}/,
    ],
    description: 'Hardcoded addresses reduce contract flexibility',
    recommendation: 'Use constructor parameters or setter functions for configurable addresses.',
  },
];

export class ContractAuditService {
  private history: AuditReport[] = [];
  private maxHistorySize = 1000;

  async analyze(source: string, language: ContractLanguage): Promise<AuditReport> {
    const startTime = Date.now();
    const reportId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const linesOfCode = source ? source.split('\n').length : 0;
    const sourceHash = this.hashSource(source);

    const findings = this.runStaticAnalysis(source, language);

    const overallScore = this.computeScore(findings);

    const summary = {
      totalFindings: findings.length,
      criticalCount: findings.filter((f) => f.severity === 'critical').length,
      highCount: findings.filter((f) => f.severity === 'high').length,
      mediumCount: findings.filter((f) => f.severity === 'medium').length,
      lowCount: findings.filter((f) => f.severity === 'low').length,
      infoCount: findings.filter((f) => f.severity === 'info').length,
      passed: overallScore >= 80,
    };

    const report: AuditReport = {
      reportId,
      overallScore,
      findings,
      summary,
      metadata: {
        language,
        linesOfCode,
        sourceHash,
        analysisDurationMs: Date.now() - startTime,
      },
      generatedAt: new Date().toISOString(),
    };

    this.history.push(report);
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }

    return report;
  }

  computeScore(findings: AuditFinding[]): number {
    if (findings.length === 0) return 100;

    const weights: Record<SeverityLevel, number> = {
      critical: 40,
      high: 20,
      medium: 10,
      low: 5,
      info: 1,
    };

    const totalDeduction = findings.reduce((sum, f) => sum + (weights[f.severity] || 0), 0);
    return Math.max(0, Math.min(100, 100 - totalDeduction));
  }

  getHistory(query?: HistoryQuery): AuditReport[] {
    let results = [...this.history];

    if (query?.minScore !== undefined) {
      results = results.filter((r) => r.overallScore >= query.minScore!);
    }
    if (query?.maxScore !== undefined) {
      results = results.filter((r) => r.overallScore <= query.maxScore!);
    }
    if (query?.language) {
      results = results.filter((r) => r.metadata.language === query.language);
    }

    results.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  getReport(reportId: string): AuditReport | undefined {
    return this.history.find((r) => r.reportId === reportId);
  }

  exportReport(reportId: string, format: 'json' | 'csv'): string {
    const report = this.history.find((r) => r.reportId === reportId);
    if (!report) return '';

    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }

    const header = 'Type,Severity,Line,Description,Recommendation';
    const rows = report.findings.map(
      (f) => `"${f.type}","${f.severity}",${f.line},"${f.description.replace(/"/g, '""')}","${f.recommendation.replace(/"/g, '""')}"`,
    );
    return [header, ...rows].join('\n');
  }

  clearHistory(): void {
    this.history = [];
  }

  private runStaticAnalysis(source: string, _language: ContractLanguage): AuditFinding[] {
    if (!source || source.trim().length === 0) return [];
    const findings: AuditFinding[] = [];
    const lines = source.split('\n');

    for (const vuln of VULNERABILITY_PATTERNS) {
      const matchedLines = new Set<number>();
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of vuln.patterns) {
          if (pattern.test(lines[i])) {
            matchedLines.add(i + 1);
          }
        }
      }

      for (const line of matchedLines) {
        findings.push({
          type: vuln.type,
          severity: vuln.severity,
          line,
          description: vuln.description,
          recommendation: vuln.recommendation,
          code: lines[line - 1]?.trim(),
        });
      }
    }

    return findings;
  }

  private hashSource(source: string): string {
    let hash = 0;
    for (let i = 0; i < source.length; i++) {
      const char = source.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

export const contractAuditService = new ContractAuditService();
