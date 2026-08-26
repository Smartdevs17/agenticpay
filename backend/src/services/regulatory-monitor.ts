/**
 * Regulatory Update Monitoring Service
 *
 * Provides automated monitoring of regulatory changes across jurisdictions.
 * In production, this would integrate with external feeds:
 * - FinCEN, OFAC, SEC (US)
 * - EU AMLD, EBA, ESMA (EU)
 * - FCA, OFSI (UK)
 * - MAS (SG)
 * - AUSTRAC (AU)
 * - FATF public statements
 * - And local regulators
 *
 * For this implementation: simulates monitoring with realistic data,
 * supports manual injection of updates, tracks impact, and triggers alerts.
 */

import { randomUUID } from 'crypto';

export type RegulatorySourceType = 'official' | 'aggregator' | 'manual';
export type RegulatoryImpactLevel = 'low' | 'medium' | 'high' | 'critical';
export type RegulatoryUpdateStatus = 'new' | 'reviewing' | 'assessed' | 'implemented' | 'dismissed';
export type JurisdictionCode = 'US' | 'EU' | 'UK' | 'SG' | 'AU' | 'GLOBAL';

export interface RegulatorySource {
  id: string;
  name: string;
  jurisdiction: JurisdictionCode;
  type: RegulatorySourceType;
  url: string;
  description: string;
  pollingIntervalHours: number;
  lastPolledAt?: string;
  lastUpdateAt?: string;
  status: 'active' | 'inactive' | 'error';
  reliabilityScore: number; // 0-100
}

export interface RegulatoryUpdate {
  id: string;
  sourceId: string;
  sourceName: string;
  jurisdiction: JurisdictionCode;
  title: string;
  summary: string;
  fullContent?: string;
  impactLevel: RegulatoryImpactLevel;
  status: RegulatoryUpdateStatus;
  categories: string[]; // ['aml', 'kyc', 'sanctions', 'reporting', 'crypto']
  publishedAt: string;
  detectedAt: string;
  effectiveDate?: string;
  complianceDeadline?: string;
  requiredActions: string[];
  relatedRegulations: string[]; // e.g. ["BSA", "AMLD6"]
  url?: string;
  assignedTo?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  implementationNotes?: string;
  riskScore: number; // 0-100
}

export interface RegulatoryMonitoringMetrics {
  totalSources: number;
  activeSources: number;
  totalUpdates: number;
  newUpdates: number;
  criticalUpdates: number;
  overdueReviews: number;
  byJurisdiction: Record<string, number>;
  byCategory: Record<string, number>;
  lastPollAt: string;
}

const SOURCES: RegulatorySource[] = [
  {
    id: 'src_fincen',
    name: 'FinCEN Guidance & Advisories',
    jurisdiction: 'US',
    type: 'official',
    url: 'https://www.fincen.gov/resources/advisories',
    description: 'US Financial Crimes Enforcement Network updates',
    pollingIntervalHours: 24,
    status: 'active',
    reliabilityScore: 95,
    lastPolledAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
  {
    id: 'src_ofac',
    name: 'OFAC Sanctions List Updates',
    jurisdiction: 'US',
    type: 'official',
    url: 'https://ofac.treasury.gov/sanctions-list-service',
    description: 'OFAC SDN and non-SDN list changes',
    pollingIntervalHours: 6,
    status: 'active',
    reliabilityScore: 98,
    lastPolledAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    id: 'src_eu_amld',
    name: 'EU AMLD & EBA Guidelines',
    jurisdiction: 'EU',
    type: 'official',
    url: 'https://www.eba.europa.eu/regulation-and-policy',
    description: 'EU Anti-Money Laundering Directive updates and EBA opinions',
    pollingIntervalHours: 24,
    status: 'active',
    reliabilityScore: 92,
    lastPolledAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
  },
  {
    id: 'src_fca',
    name: 'FCA Policy & Handbook Updates',
    jurisdiction: 'UK',
    type: 'official',
    url: 'https://www.fca.org.uk/news',
    description: 'UK Financial Conduct Authority regulatory updates',
    pollingIntervalHours: 24,
    status: 'active',
    reliabilityScore: 90,
    lastPolledAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
  },
  {
    id: 'src_mas',
    name: 'MAS AML/CFT Notices',
    jurisdiction: 'SG',
    type: 'official',
    url: 'https://www.mas.gov.sg/regulation/notices',
    description: 'Monetary Authority of Singapore AML/CFT regulatory notices',
    pollingIntervalHours: 24,
    status: 'active',
    reliabilityScore: 88,
    lastPolledAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
  },
  {
    id: 'src_austrac',
    name: 'AUSTRAC Guidance',
    jurisdiction: 'AU',
    type: 'official',
    url: 'https://www.austrac.gov.au/business/guidance',
    description: 'AUSTRAC AML/CTF guidance and reporting obligations',
    pollingIntervalHours: 24,
    status: 'active',
    reliabilityScore: 89,
    lastPolledAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
  },
  {
    id: 'src_fatf',
    name: 'FATF Public Statements & Guidance',
    jurisdiction: 'GLOBAL',
    type: 'official',
    url: 'https://www.fatf-gafi.org/publications/',
    description: 'Financial Action Task Force global standards and mutual evaluations',
    pollingIntervalHours: 48,
    status: 'active',
    reliabilityScore: 97,
    lastPolledAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
  },
  {
    id: 'src_psd2_pds3',
    name: 'EU PSD2/PSD3 & Instant Payments',
    jurisdiction: 'EU',
    type: 'aggregator',
    url: 'https://ec.europa.eu/finance/payments',
    description: 'Payment Services Directive updates impacting payment service providers',
    pollingIntervalHours: 48,
    status: 'active',
    reliabilityScore: 85,
    lastPolledAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
  },
];

let updates: RegulatoryUpdate[] = [
  {
    id: `reg_${randomUUID()}`,
    sourceId: 'src_fincen',
    sourceName: 'FinCEN Guidance & Advisories',
    jurisdiction: 'US',
    title: 'FinCEN Alert on Virtual Currency Mixing Services',
    summary: 'FinCEN issues updated guidance on reporting obligations for virtual currency mixing services and enhanced due diligence requirements.',
    fullContent: 'Financial institutions are advised to apply enhanced scrutiny to transactions involving virtual currency mixing services...',
    impactLevel: 'high',
    status: 'new',
    categories: ['aml', 'crypto', 'reporting'],
    publishedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    detectedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
    effectiveDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    complianceDeadline: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
    requiredActions: [
      'Update AML monitoring rules to detect mixing service patterns',
      'Enhance KYC questionnaire for mixing service exposure',
      'Train compliance staff on new typologies',
      'Review existing transaction history for mixer interactions',
    ],
    relatedRegulations: ['BSA', 'FinCEN CDD Rule'],
    url: 'https://www.fincen.gov/resources/advisories',
    riskScore: 85,
  },
  {
    id: `reg_${randomUUID()}`,
    sourceId: 'src_eu_amld',
    sourceName: 'EU AMLD & EBA Guidelines',
    jurisdiction: 'EU',
    title: 'AMLD6 Implementation — Beneficial Ownership Registry Changes',
    summary: 'EU member states to restrict public access to beneficial ownership registers, new lawful interest access mechanism required.',
    impactLevel: 'medium',
    status: 'reviewing',
    categories: ['kyc', 'aml', 'reporting'],
    publishedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    detectedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
    effectiveDate: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    complianceDeadline: new Date(Date.now() + 120 * 24 * 3600 * 1000).toISOString(),
    requiredActions: [
      'Update beneficial ownership verification flow for EU entities',
      'Implement lawful interest access request handling',
      'Adjust KYC risk scoring for reduced registry transparency',
    ],
    relatedRegulations: ['AMLD6', 'EU GDPR'],
    url: 'https://www.eba.europa.eu',
    riskScore: 65,
    assignedTo: 'compliance-eu-team',
  },
  {
    id: `reg_${randomUUID()}`,
    sourceId: 'src_ofac',
    sourceName: 'OFAC Sanctions List Updates',
    jurisdiction: 'US',
    title: 'OFAC Adds 12 Entities to SDN List — Crypto-Related',
    summary: '12 additional virtual currency addresses added to SDN list pursuant to counter-terrorism authorities.',
    impactLevel: 'critical',
    status: 'new',
    categories: ['sanctions', 'crypto'],
    publishedAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    detectedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    effectiveDate: new Date().toISOString(),
    complianceDeadline: new Date().toISOString(),
    requiredActions: [
      'Immediate screening against updated SDN list',
      'Freeze any matched assets and file blocking report',
      'Review transaction history for previously missed hits',
      'File SAR if applicable',
    ],
    relatedRegulations: ['OFAC SDN', 'IEEPA'],
    url: 'https://ofac.treasury.gov',
    riskScore: 98,
  },
  {
    id: `reg_${randomUUID()}`,
    sourceId: 'src_fatf',
    sourceName: 'FATF Public Statements & Guidance',
    jurisdiction: 'GLOBAL',
    title: 'FATF Updated Guidance on Virtual Assets and VASPs — Travel Rule Clarification',
    summary: 'FATF clarifies travel rule implementation for unhosted wallet transactions and batch threshold of $1000 USD/EUR.',
    impactLevel: 'high',
    status: 'assessed',
    categories: ['crypto', 'aml', 'reporting'],
    publishedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
    detectedAt: new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString(),
    effectiveDate: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
    complianceDeadline: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),
    requiredActions: [
      'Implement Travel Rule solution for VASP-to-VASP transfers',
      'Collect and store originator/beneficiary info for transfers over threshold',
      'Conduct counterparty VASP due diligence',
    ],
    relatedRegulations: ['FATF Recommendation 16', 'Travel Rule'],
    url: 'https://www.fatf-gafi.org/publications/',
    riskScore: 80,
    reviewedBy: 'compliance-lead',
    reviewedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  },
];

export class RegulatoryMonitorService {
  static getSources(jurisdiction?: JurisdictionCode): RegulatorySource[] {
    if (!jurisdiction) return [...SOURCES];
    return SOURCES.filter((s) => s.jurisdiction === jurisdiction || jurisdiction === 'GLOBAL' || s.jurisdiction === 'GLOBAL');
  }

  static getSourceById(id: string): RegulatorySource | null {
    return SOURCES.find((s) => s.id === id) ?? null;
  }

  static getUpdates(filters?: {
    jurisdiction?: JurisdictionCode;
    status?: RegulatoryUpdateStatus;
    impactLevel?: RegulatoryImpactLevel;
    category?: string;
    limit?: number;
  }): RegulatoryUpdate[] {
    let list = [...updates];
    if (filters?.jurisdiction) list = list.filter((u) => u.jurisdiction === filters.jurisdiction || filters.jurisdiction === 'GLOBAL');
    if (filters?.status) list = list.filter((u) => u.status === filters.status);
    if (filters?.impactLevel) list = list.filter((u) => u.impactLevel === filters.impactLevel);
    if (filters?.category) list = list.filter((u) => u.categories.includes(filters.category!));
    list.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    if (filters?.limit) list = list.slice(0, filters.limit);
    return list;
  }

  static getUpdateById(id: string): RegulatoryUpdate | null {
    return updates.find((u) => u.id === id) ?? null;
  }

  static addUpdate(update: Omit<RegulatoryUpdate, 'id' | 'detectedAt'>): RegulatoryUpdate {
    const full: RegulatoryUpdate = {
      ...update,
      id: `reg_${randomUUID()}`,
      detectedAt: new Date().toISOString(),
    };
    updates.push(full);
    return full;
  }

  static updateStatus(
    id: string,
    status: RegulatoryUpdateStatus,
    notes?: string,
    reviewedBy?: string,
  ): RegulatoryUpdate {
    const idx = updates.findIndex((u) => u.id === id);
    if (idx === -1) throw new Error(`Regulatory update not found: ${id}`);
    updates[idx] = {
      ...updates[idx],
      status,
      implementationNotes: notes ?? updates[idx].implementationNotes,
      reviewedBy: reviewedBy ?? updates[idx].reviewedBy,
      reviewedAt: new Date().toISOString(),
    };
    return updates[idx];
  }

  static getMetrics(): RegulatoryMonitoringMetrics {
    const now = new Date();
    const overdueThreshold = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    return {
      totalSources: SOURCES.length,
      activeSources: SOURCES.filter((s) => s.status === 'active').length,
      totalUpdates: updates.length,
      newUpdates: updates.filter((u) => u.status === 'new').length,
      criticalUpdates: updates.filter((u) => u.impactLevel === 'critical').length,
      overdueReviews: updates.filter((u) => u.status === 'new' && new Date(u.detectedAt) < overdueThreshold).length,
      byJurisdiction: updates.reduce((acc, u) => {
        acc[u.jurisdiction] = (acc[u.jurisdiction] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byCategory: updates.reduce((acc, u) => {
        u.categories.forEach((c) => {
          acc[c] = (acc[c] || 0) + 1;
        });
        return acc;
      }, {} as Record<string, number>),
      lastPollAt: new Date(Math.max(...SOURCES.map((s) => new Date(s.lastPolledAt ?? 0).getTime()))).toISOString(),
    };
  }

  /**
   * Simulate polling all active sources for new updates.
   * In production, this would fetch RSS feeds, APIs, web scraping.
   * Returns number of new updates detected (simulated).
   */
  static async pollSources(): Promise<{ polled: number; newUpdates: number; errors: string[] }> {
    const errors: string[] = [];
    let newUpdatesCount = 0;

    for (const source of SOURCES) {
      if (source.status !== 'active') continue;
      try {
        // Simulate polling latency
        await new Promise((r) => setTimeout(r, 50));

        // Randomly simulate finding a new update (10% chance)
        if (Math.random() < 0.1) {
          const simulated: Omit<RegulatoryUpdate, 'id' | 'detectedAt'> = {
            sourceId: source.id,
            sourceName: source.name,
            jurisdiction: source.jurisdiction,
            title: `[Auto-detected] Regulatory change from ${source.name}`,
            summary: `Automated monitoring detected a potential regulatory update from ${source.name}. Manual review recommended.`,
            impactLevel: Math.random() > 0.7 ? 'high' : 'medium',
            status: 'new',
            categories: ['aml'],
            publishedAt: new Date().toISOString(),
            requiredActions: ['Review update', 'Assess impact', 'Update compliance controls if needed'],
            relatedRegulations: [source.jurisdiction],
            url: source.url,
            riskScore: Math.floor(Math.random() * 40) + 50,
          };
          this.addUpdate(simulated);
          newUpdatesCount++;
        }

        source.lastPolledAt = new Date().toISOString();
      } catch (err) {
        errors.push(`Source ${source.id} poll failed: ${(err as Error).message}`);
        source.status = 'error';
      }
    }

    return { polled: SOURCES.filter((s) => s.status === 'active').length, newUpdates: newUpdatesCount, errors };
  }

  static assessImpact(updateId: string): { riskScore: number; recommendedActions: string[] } {
    const update = this.getUpdateById(updateId);
    if (!update) throw new Error(`Update not found: ${updateId}`);

    // Simple impact scoring
    let score = update.riskScore;
    if (update.impactLevel === 'critical') score = Math.min(100, score + 10);
    if (update.jurisdiction === 'GLOBAL' || update.jurisdiction === 'US') score = Math.min(100, score + 5);

    const recommended = [...update.requiredActions];
    if (score > 80) {
      recommended.push('Immediate executive briefing required');
      recommended.push('Consider temporary transaction holds for affected corridor');
    }

    return { riskScore: score, recommendedActions: recommended };
  }

  static getUpcomingDeadlines(daysAhead = 30): RegulatoryUpdate[] {
    const now = new Date();
    const cutoff = new Date(now.getTime() + daysAhead * 24 * 3600 * 1000);
    return updates
      .filter((u) => u.complianceDeadline && new Date(u.complianceDeadline) <= cutoff && u.status !== 'implemented' && u.status !== 'dismissed')
      .sort((a, b) => new Date(a.complianceDeadline!).getTime() - new Date(b.complianceDeadline!).getTime());
  }
}
