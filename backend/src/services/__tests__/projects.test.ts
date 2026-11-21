import { beforeEach, describe, expect, it } from 'vitest';
import { projectsService } from '../projects.js';

describe('projectsService', () => {
  beforeEach(() => {
    projectsService.resetForTests();
  });

  it('creates project and milestones', () => {
    const project = projectsService.createProject({
      name: 'Brand Refresh',
      clientId: 'client_1',
      ownerId: 'owner_1',
      budget: 4000,
      currency: 'USD',
      startDate: new Date().toISOString(),
    });

    const milestone = projectsService.addMilestone(project.id, {
      title: 'Homepage redesign',
      deliverable: 'Figma + handoff',
      amount: 1000,
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    });

    expect(milestone).toBeDefined();
    expect(projectsService.listMilestones(project.id)).toHaveLength(1);
  });

  it('submits and approves deliverables with automatic payment release', () => {
    const project = projectsService.createProject({
      name: 'API Build',
      clientId: 'client_2',
      ownerId: 'owner_2',
      budget: 2000,
      currency: 'USD',
      startDate: new Date().toISOString(),
    });

    const milestone = projectsService.addMilestone(project.id, {
      title: 'Backend APIs',
      deliverable: 'REST + docs',
      amount: 1200,
      dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    })!;

    projectsService.submitDeliverable(project.id, milestone.id, 'https://github.com/example/repo/pull/1', 'Ready for review');
    const approval = projectsService.approveDeliverable(project.id, milestone.id, 'client_2');

    expect(approval?.milestone.status).toBe('released');
    expect(approval?.release.amount).toBe(1200);
    expect(projectsService.getReleases(project.id)).toHaveLength(1);
  });

  it('supports dispute flow and dashboard progress tracking', () => {
    const project = projectsService.createProject({
      name: 'Video Production',
      clientId: 'client_3',
      ownerId: 'owner_3',
      budget: 5000,
      currency: 'USD',
      startDate: new Date().toISOString(),
    });

    const milestone = projectsService.addMilestone(project.id, {
      title: 'Draft video',
      deliverable: '4K export',
      amount: 2500,
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    })!;

    projectsService.submitDeliverable(project.id, milestone.id, 'https://example.com/draft.mp4');
    const disputed = projectsService.disputeMilestone(project.id, milestone.id, 'Audio quality mismatch');
    const dashboard = projectsService.getDashboard(project.id);

    expect(disputed?.status).toBe('disputed');
    expect(dashboard?.project.status).toBe('disputed');
    expect(dashboard?.progressPercent).toBe(0);
  });

  it('supports scope change, client portal review, and archival', () => {
    const project = projectsService.createProject({
      name: 'Content Campaign',
      clientId: 'client_4',
      ownerId: 'owner_4',
      budget: 1000,
      currency: 'USD',
      startDate: new Date().toISOString(),
    });

    const milestone = projectsService.addMilestone(project.id, {
      title: 'Draft pack',
      deliverable: '5 drafts',
      amount: 500,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    })!;

    projectsService.submitDeliverable(project.id, milestone.id, 'https://example.com/doc');
    const reviewPortal = projectsService.getClientReviewPortal('client_4');
    const scoped = projectsService.applyScopeChange(project.id, 250);
    const archived = projectsService.archiveProject(project.id);

    expect(reviewPortal).toHaveLength(1);
    expect(scoped?.budget).toBe(1250);
    expect(archived?.status).toBe('archived');
  });
});