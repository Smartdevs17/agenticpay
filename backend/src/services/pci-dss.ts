/**
 * PCI DSS Compliance Dashboard — Issue #924
 *
 * Models PCI DSS v4.0 as a catalogue of the twelve top-level requirements, each
 * backed by concrete controls with an evidence-backed status. Aggregating the
 * control statuses produces a per-requirement compliance percentage, a weighted
 * overall score, and a prioritised list of gaps with remediation guidance.
 *
 * Statuses are held in memory and seeded with a realistic sample posture so the
 * dashboard renders immediately; call `setControlStatus()` (or the API) as real
 * evidence is gathered.
 */

export type PciDssControlStatus = 'in_place' | 'not_in_place' | 'not_tested' | 'not_applicable';
export type PciDssRequirementStatus =
  | 'compliant'
  | 'in_place_with_deficiencies'
  | 'non_compliant'
  | 'not_applicable';
export type PciDssPriority = 'high' | 'medium' | 'low';

export type PciDssCategory =
  | 'network_security'
  | 'secure_configuration'
  | 'account_data_protection'
  | 'cryptography'
  | 'malware_protection'
  | 'secure_development'
  | 'access_control'
  | 'authentication'
  | 'physical_security'
  | 'logging_monitoring'
  | 'security_testing'
  | 'security_policy';

export interface PciDssControlDefinition {
  id: string;
  title: string;
  requirementId: number;
  priority: PciDssPriority;
  /** Framework/regulatory reference, e.g. "PCI DSS v4.0 Req 3.5.1". */
  reference: string;
  remediation: string;
  defaultStatus: PciDssControlStatus;
}

export interface PciDssRequirementDefinition {
  id: number;
  title: string;
  category: PciDssCategory;
  /** Relative weight used when computing the overall score. */
  weight: number;
  controls: PciDssControlDefinition[];
}

export interface PciDssGap {
  controlId: string;
  controlTitle: string;
  requirementId: number;
  requirementTitle: string;
  status: Exclude<PciDssControlStatus, 'in_place'>;
  priority: PciDssPriority;
  reference: string;
  remediation: string;
}

export interface PciDssControlAssessment extends PciDssControlDefinition {
  status: PciDssControlStatus;
  evidence?: string;
  testedAt?: string;
}

export interface PciDssRequirementAssessment {
  id: number;
  title: string;
  category: PciDssCategory;
  weight: number;
  status: PciDssRequirementStatus;
  compliancePercent: number;
  controls: PciDssControlAssessment[];
  gaps: PciDssGap[];
}

export interface PciDssDashboard {
  version: '4.0';
  generatedAt: string;
  overallScore: number;
  overallStatus: PciDssRequirementStatus;
  assessedBy?: string;
  requirementStatusCounts: Record<PciDssRequirementStatus, number>;
  controlStatusCounts: Record<PciDssControlStatus, number>;
  evidenceCoverage: number;
  requirements: PciDssRequirementAssessment[];
  gaps: PciDssGap[];
}

// ─── Catalogue ────────────────────────────────────────────────────────────────

function control(
  id: string,
  requirementId: number,
  title: string,
  priority: PciDssPriority,
  reference: string,
  remediation: string,
  defaultStatus: PciDssControlStatus,
): PciDssControlDefinition {
  return { id, requirementId, title, priority, reference, remediation, defaultStatus };
}

export const PCI_DSS_REQUIREMENTS: PciDssRequirementDefinition[] = [
  {
    id: 1,
    title: 'Install and Maintain Network Security Controls',
    category: 'network_security',
    weight: 1,
    controls: [
      control('1.2.1', 1, 'Network security controls configuration standards are defined and applied', 'high', 'PCI DSS v4.0 Req 1.2.1', 'Document and apply firewall/router configuration standards', 'in_place'),
      control('1.3.1', 1, 'Inbound traffic to the CDE is restricted to necessary services', 'high', 'PCI DSS v4.0 Req 1.3.1', 'Restrict inbound CDE traffic to required ports and services', 'in_place'),
      control('1.4.2', 1, 'Outbound traffic from the CDE is restricted', 'medium', 'PCI DSS v4.0 Req 1.4.2', 'Restrict outbound CDE traffic to approved destinations', 'in_place'),
    ],
  },
  {
    id: 2,
    title: 'Apply Secure Configurations to All System Components',
    category: 'secure_configuration',
    weight: 1,
    controls: [
      control('2.2.1', 2, 'Configuration standards are defined, implemented and maintained', 'high', 'PCI DSS v4.0 Req 2.2.1', 'Harden system baselines and review against CIS benchmarks', 'in_place'),
      control('2.2.7', 2, 'Default accounts and passwords are removed or disabled', 'high', 'PCI DSS v4.0 Req 2.2.7', 'Disable/rename default vendor accounts before deployment', 'in_place'),
      control('2.3.1', 2, 'Wireless environments are secure by default', 'low', 'PCI DSS v4.0 Req 2.3.1', 'Update AP firmware and rotate wireless keys on change', 'not_tested'),
    ],
  },
  {
    id: 3,
    title: 'Protect Stored Account Data',
    category: 'account_data_protection',
    weight: 2,
    controls: [
      control('3.2.1', 3, 'Account data storage is kept to a minimum', 'high', 'PCI DSS v4.0 Req 3.2.1', 'Implement data-retention and purging before storage', 'in_place'),
      control('3.5.1', 3, 'Primary account numbers are rendered unreadable wherever stored', 'high', 'PCI DSS v4.0 Req 3.5.1', 'Apply strong cryptography (AES-256-GCM) to stored PANs', 'in_place'),
      control('3.4.2', 3, 'Disk-level encryption is used for stored account data', 'medium', 'PCI DSS v4.0 Req 3.4.2', 'Enable full-disk/volume encryption for CDE databases', 'in_place'),
      control('3.6.1', 3, 'Cryptographic keys are protected and rotated', 'high', 'PCI DSS v4.0 Req 3.6.1', 'Adopt a documented key-management and rotation policy', 'not_in_place'),
    ],
  },
  {
    id: 4,
    title: 'Protect Cardholder Data with Strong Cryptography During Transmission',
    category: 'cryptography',
    weight: 2,
    controls: [
      control('4.2.1', 4, 'Strong cryptography protects PANs during transmission over open networks', 'high', 'PCI DSS v4.0 Req 4.2.1', 'Enforce TLS 1.2+ and disable weak cipher suites', 'in_place'),
      control('4.2.1.1', 4, 'Certificates and keys used for transmission are current and trusted', 'medium', 'PCI DSS v4.0 Req 4.2.1.1', 'Automate certificate expiry monitoring and renewal', 'not_in_place'),
    ],
  },
  {
    id: 5,
    title: 'Protect All Systems and Networks from Malicious Software',
    category: 'malware_protection',
    weight: 1,
    controls: [
      control('5.2.1', 5, 'Malware protection is deployed on all applicable system components', 'high', 'PCI DSS v4.0 Req 5.2.1', 'Deploy and maintain anti-malware on all applicable systems', 'in_place'),
      control('5.3.1', 5, 'Anti-malware mechanisms are kept current and actively running', 'medium', 'PCI DSS v4.0 Req 5.3.1', 'Enable automatic signature updates and health monitoring', 'in_place'),
    ],
  },
  {
    id: 6,
    title: 'Develop and Maintain Secure Systems and Software',
    category: 'secure_development',
    weight: 2,
    controls: [
      control('6.2.1', 6, 'Secure coding practices are defined and applied', 'high', 'PCI DSS v4.0 Req 6.2.1', 'Adopt the OWASP secure coding guidelines in CI', 'in_place'),
      control('6.3.3', 6, 'Security patches are installed within defined timeframes', 'high', 'PCI DSS v4.0 Req 6.3.3', 'Track patching SLAs and remediate critical CVEs quickly', 'not_tested'),
      control('6.4.1', 6, 'Public web applications are protected by a WAF', 'high', 'PCI DSS v4.0 Req 6.4.1', 'Deploy a WAF in front of internet-facing applications', 'in_place'),
    ],
  },
  {
    id: 7,
    title: 'Restrict Access to System Components and Cardholder Data by Business Need to Know',
    category: 'access_control',
    weight: 1,
    controls: [
      control('7.2.1', 7, 'Access control model is defined with least privilege', 'high', 'PCI DSS v4.0 Req 7.2.1', 'Define and enforce least-privilege role assignments', 'in_place'),
      control('7.2.4', 7, 'Access is reviewed at least every six months', 'medium', 'PCI DSS v4.0 Req 7.2.4', 'Schedule recurring access recertification', 'in_place'),
    ],
  },
  {
    id: 8,
    title: 'Identify Users and Authenticate Access to System Components',
    category: 'authentication',
    weight: 2,
    controls: [
      control('8.2.1', 8, 'All users are assigned a unique ID', 'high', 'PCI DSS v4.0 Req 8.2.1', 'Eliminate shared accounts in the CDE', 'in_place'),
      control('8.4.2', 8, 'Multi-factor authentication is enforced for all access into the CDE', 'high', 'PCI DSS v4.0 Req 8.4.2', 'Enforce MFA (TOTP/WebAuthn) for CDE access', 'in_place'),
      control('8.3.6', 8, 'Passwords meet minimum complexity requirements', 'medium', 'PCI DSS v4.0 Req 8.3.6', 'Enforce length/complexity and breach-list checks', 'in_place'),
    ],
  },
  {
    id: 9,
    title: 'Restrict Physical Access to Cardholder Data',
    category: 'physical_security',
    weight: 1,
    controls: [
      control('9.2.1', 9, 'Appropriate facility entry controls are in place', 'medium', 'PCI DSS v4.0 Req 9.2.1', 'Document and enforce physical entry controls', 'not_applicable'),
      control('9.4.1', 9, 'Media with cardholder data is securely stored and destroyed', 'medium', 'PCI DSS v4.0 Req 9.4.1', 'Apply media handling and destruction procedures', 'not_tested'),
    ],
  },
  {
    id: 10,
    title: 'Log and Monitor All Access to System Components and Cardholder Data',
    category: 'logging_monitoring',
    weight: 2,
    controls: [
      control('10.2.1', 10, 'Audit logs capture access to system components and cardholder data', 'high', 'PCI DSS v4.0 Req 10.2.1', 'Enable immutable audit logging for CDE access', 'in_place'),
      control('10.3.3', 10, 'Audit logs are protected from destruction and modification', 'high', 'PCI DSS v4.0 Req 10.3.3', 'Write logs to append-only/WORM storage', 'in_place'),
      control('10.7.2', 10, 'Anomalies and suspicious activity trigger alerts', 'high', 'PCI DSS v4.0 Req 10.7.2', 'Wire SIEM detections to on-call alerting', 'in_place'),
    ],
  },
  {
    id: 11,
    title: 'Test Security of Systems and Networks Regularly',
    category: 'security_testing',
    weight: 2,
    controls: [
      control('11.3.1', 11, 'Internal vulnerability scans are performed quarterly', 'high', 'PCI DSS v4.0 Req 11.3.1', 'Schedule recurring internal vulnerability scans', 'in_place'),
      control('11.4.1', 11, 'External penetration testing is performed annually', 'high', 'PCI DSS v4.0 Req 11.4.1', 'Engage an external pen-test provider at least annually', 'not_in_place'),
      control('11.5.1', 11, 'Changes to the CDE are detected and alerted', 'medium', 'PCI DSS v4.0 Req 11.5.1', 'Deploy file-integrity monitoring for CDE systems', 'not_tested'),
    ],
  },
  {
    id: 12,
    title: 'Support Information Security with Organizational Policies and Programs',
    category: 'security_policy',
    weight: 1,
    controls: [
      control('12.1.1', 12, 'An overall information security policy is established and reviewed', 'medium', 'PCI DSS v4.0 Req 12.1.1', 'Publish and review the security policy annually', 'in_place'),
      control('12.6.1', 12, 'A security awareness program is in place', 'medium', 'PCI DSS v4.0 Req 12.6.1', 'Run recurring security-awareness training', 'in_place'),
      control('12.10.1', 12, 'Incident response plan exists and is tested', 'high', 'PCI DSS v4.0 Req 12.10.1', 'Maintain and exercise the incident-response plan', 'not_in_place'),
    ],
  },
];

// ─── In-memory evidence store ─────────────────────────────────────────────────

interface ControlState {
  status: PciDssControlStatus;
  evidence?: string;
  testedAt?: string;
}

const controlState = new Map<string, ControlState>();

function seedDefaults(): void {
  controlState.clear();
  for (const requirement of PCI_DSS_REQUIREMENTS) {
    for (const item of requirement.controls) {
      controlState.set(item.id, { status: item.defaultStatus });
    }
  }
}

seedDefaults();

export function resetPciDssEvidence(): void {
  seedDefaults();
}

export function setControlStatus(
  controlId: string,
  status: PciDssControlStatus,
  evidence?: string,
): PciDssControlAssessment {
  const definition = PCI_DSS_REQUIREMENTS.flatMap((r) => r.controls).find((c) => c.id === controlId);
  if (!definition) throw new Error(`Unknown PCI DSS control: ${controlId}`);
  const state: ControlState = { status, evidence, testedAt: new Date().toISOString() };
  controlState.set(controlId, state);
  return { ...definition, ...state };
}

export function getControlStatus(controlId: string): PciDssControlAssessment | null {
  const definition = PCI_DSS_REQUIREMENTS.flatMap((r) => r.controls).find((c) => c.id === controlId);
  if (!definition) return null;
  const state = controlState.get(controlId) ?? { status: definition.defaultStatus };
  return { ...definition, ...state };
}

// ─── Assessment ───────────────────────────────────────────────────────────────

function deriveRequirementStatus(controls: PciDssControlAssessment[]): PciDssRequirementStatus {
  const applicable = controls.filter((c) => c.status !== 'not_applicable');
  if (applicable.length === 0) return 'not_applicable';
  if (applicable.some((c) => c.status === 'not_in_place')) return 'non_compliant';
  if (applicable.some((c) => c.status === 'not_tested')) return 'in_place_with_deficiencies';
  return 'compliant';
}

function compliancePercent(controls: PciDssControlAssessment[]): number {
  const applicable = controls.filter((c) => c.status !== 'not_applicable');
  if (applicable.length === 0) return 100;
  const inPlace = applicable.filter((c) => c.status === 'in_place').length;
  return Number(((inPlace / applicable.length) * 100).toFixed(2));
}

function priorityRank(priority: PciDssPriority): number {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
}

function sortGaps(gaps: PciDssGap[]): PciDssGap[] {
  return [...gaps].sort(
    (a, b) =>
      priorityRank(a.priority) - priorityRank(b.priority) ||
      a.requirementId - b.requirementId ||
      a.controlId.localeCompare(b.controlId),
  );
}

export function assessPciDss(): PciDssRequirementAssessment[] {
  return PCI_DSS_REQUIREMENTS.map((requirement) => {
    const controls: PciDssControlAssessment[] = requirement.controls.map((item) => ({
      ...item,
      status: controlState.get(item.id)?.status ?? item.defaultStatus,
      evidence: controlState.get(item.id)?.evidence,
      testedAt: controlState.get(item.id)?.testedAt,
    }));

    const gaps: PciDssGap[] = controls
      .filter((c) => c.status === 'not_in_place' || c.status === 'not_tested')
      .map((c) => ({
        controlId: c.id,
        controlTitle: c.title,
        requirementId: requirement.id,
        requirementTitle: requirement.title,
        status: c.status as Exclude<PciDssControlStatus, 'in_place'>,
        priority: c.priority,
        reference: c.reference,
        remediation: c.remediation,
      }))
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.controlId.localeCompare(b.controlId));

    return {
      id: requirement.id,
      title: requirement.title,
      category: requirement.category,
      weight: requirement.weight,
      status: deriveRequirementStatus(controls),
      compliancePercent: compliancePercent(controls),
      controls,
      gaps,
    };
  });
}

export function buildPciDssDashboard(options: { assessedBy?: string } = {}): PciDssDashboard {
  const requirements = assessPciDss();

  const requirementStatusCounts: Record<PciDssRequirementStatus, number> = {
    compliant: 0,
    in_place_with_deficiencies: 0,
    non_compliant: 0,
    not_applicable: 0,
  };
  const controlStatusCounts: Record<PciDssControlStatus, number> = {
    in_place: 0,
    not_in_place: 0,
    not_tested: 0,
    not_applicable: 0,
  };

  let weightedScore = 0;
  let weightTotal = 0;
  let testableControls = 0;
  let testedControls = 0;

  for (const requirement of requirements) {
    requirementStatusCounts[requirement.status] += 1;

    const applicable = requirement.controls.filter((c) => c.status !== 'not_applicable');
    if (applicable.length > 0) {
      weightedScore += requirement.compliancePercent * requirement.weight;
      weightTotal += requirement.weight;
    }

    for (const item of requirement.controls) {
      controlStatusCounts[item.status] += 1;
      if (item.status !== 'not_applicable') {
        testableControls += 1;
        if (item.status !== 'not_tested') testedControls += 1;
      }
    }
  }

  const overallScore = weightTotal > 0 ? Number((weightedScore / weightTotal).toFixed(2)) : 100;
  const overallStatus: PciDssRequirementStatus = requirementStatusCounts.non_compliant > 0
    ? 'non_compliant'
    : requirementStatusCounts.in_place_with_deficiencies > 0
      ? 'in_place_with_deficiencies'
      : 'compliant';

  const gaps = sortGaps(requirements.flatMap((r) => r.gaps));

  return {
    version: '4.0',
    generatedAt: new Date().toISOString(),
    overallScore,
    overallStatus,
    assessedBy: options.assessedBy,
    requirementStatusCounts,
    controlStatusCounts,
    evidenceCoverage: testableControls > 0 ? Number(((testedControls / testableControls) * 100).toFixed(2)) : 100,
    requirements,
    gaps,
  };
}

export function getPciDssGaps(priority?: PciDssPriority): PciDssGap[] {
  const gaps = sortGaps(assessPciDss().flatMap((r) => r.gaps));
  return priority ? gaps.filter((gap) => gap.priority === priority) : gaps;
}

export function exportPciDssEvidenceCsv(): string {
  const header = 'requirement_id,requirement,control_id,control,status,priority,reference,evidence,tested_at';
  const rows: string[] = [];
  for (const requirement of assessPciDss()) {
    for (const item of requirement.controls) {
      rows.push(
        [
          requirement.id,
          requirement.title,
          item.id,
          item.title,
          item.status,
          item.priority,
          item.reference,
          `"${(item.evidence ?? '').replace(/"/g, '""')}"`,
          item.testedAt ?? '',
        ].join(','),
      );
    }
  }
  return [header, ...rows].join('\n');
}
