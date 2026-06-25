// Seed scenarios — Issue #525
// Preset scenario configurations for different data volumes and patterns

export interface SeedScenario {
  name: string;
  description: string;
  userCount: number;
  projectsPerUser: number;
  milestonesPerProject: number;
  paymentsPerMilestone: number;
  invoicesPerProject: number;
  includeFailedPayments: boolean;
  includeDisputedProjects: boolean;
}

export const scenarios: Record<string, SeedScenario> = {
  small: {
    name: 'small',
    description: 'Small dataset: 10 users, 100 transactions',
    userCount: 10,
    projectsPerUser: 1,
    milestonesPerProject: 3,
    paymentsPerMilestone: 1,
    invoicesPerProject: 2,
    includeFailedPayments: true,
    includeDisputedProjects: false,
  },
  medium: {
    name: 'medium',
    description: 'Medium dataset: 100 users, 10k transactions',
    userCount: 100,
    projectsPerUser: 2,
    milestonesPerProject: 3,
    paymentsPerMilestone: 2,
    invoicesPerProject: 3,
    includeFailedPayments: true,
    includeDisputedProjects: true,
  },
  large: {
    name: 'large',
    description: 'Large dataset: 1000 users, 1M transactions (caution: slow)',
    userCount: 1000,
    projectsPerUser: 3,
    milestonesPerProject: 5,
    paymentsPerMilestone: 3,
    invoicesPerProject: 5,
    includeFailedPayments: true,
    includeDisputedProjects: true,
  },
  disputes: {
    name: 'disputes',
    description: 'Scenario with high disputed transaction rate',
    userCount: 50,
    projectsPerUser: 2,
    milestonesPerProject: 4,
    paymentsPerMilestone: 2,
    invoicesPerProject: 3,
    includeFailedPayments: true,
    includeDisputedProjects: true,
  },
};

export function getScenario(name: string = 'small'): SeedScenario {
  return scenarios[name] || scenarios.small;
}

export function listScenarios(): string[] {
  return Object.keys(scenarios);
}
