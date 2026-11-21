import { describe, expect, it, beforeEach } from 'vitest';
import { EscrowService, type MultisigEscrowPolicy } from '../escrow.js';
import { multisigService } from '../multisig.js';

describe('Multi-sig Escrow Release (#564)', () => {
  let escrowService: EscrowService;

  beforeEach(() => {
    escrowService = new EscrowService();
  });

  const policy: MultisigEscrowPolicy = {
    groupId: '',
    threshold: 2,
    challengePeriodMs: 0,
  };

  async function setupEscrowWithMultisig() {
    const group = multisigService.createGroup({
      name: 'escrow-signers',
      walletAddresses: ['alice', 'bob', 'charlie'],
      threshold: 2,
      timeoutSeconds: 3600,
    });
    policy.groupId = group.id;

    const escrow = await escrowService.createEscrow({
      projectId: 'proj-1',
      clientAddress: 'alice',
      freelancerAddress: 'freelancer-1',
      arbitratorAddresses: ['arb-1'],
      amount: '1000',
      asset: 'XLM',
      network: 'stellar',
      deadline: Date.now() + 86400000,
      multisigPolicy: policy,
    });

    await escrowService.fundEscrow(escrow.id, 'tx-hash-1');
    return escrow;
  }

  it('creates a release request with implicit initiator approval', async () => {
    const escrow = await setupEscrowWithMultisig();
    const request = await escrowService.createReleaseRequest(escrow.id, 'alice', 'release_to_freelancer');

    expect(request.status).toBe('pending');
    expect(request.initiator).toBe('alice');
    expect(request.approvals).toHaveLength(1);
    expect(request.approvals[0].signer).toBe('alice');
    expect(request.type).toBe('release_to_freelancer');
  });

  it('rejects release request from non-signer', async () => {
    const escrow = await setupEscrowWithMultisig();
    await expect(
      escrowService.createReleaseRequest(escrow.id, 'outsider', 'release_to_freelancer')
    ).rejects.toThrow('Initiator is not a signer');
  });

  it('approves release request and auto-executes when threshold met and challenge period elapsed', async () => {
    const escrow = await setupEscrowWithMultisig();
    const request = await escrowService.createReleaseRequest(escrow.id, 'alice', 'release_to_freelancer');

    const result = await escrowService.approveReleaseRequest(escrow.id, 'bob', 'sig-bob');
    expect(result.approvals).toHaveLength(2);
    expect(result.status).toBe('executed');

    const updatedEscrow = await escrowService.getEscrow(escrow.id);
    expect(updatedEscrow?.status).toBe('released');
    expect(updatedEscrow?.release?.approvedBy).toContain('alice');
    expect(updatedEscrow?.release?.approvedBy).toContain('bob');
  });

  it('does not auto-execute when challenge period has not elapsed', async () => {
    const group = multisigService.createGroup({
      name: 'delayed-signers',
      walletAddresses: ['alice', 'bob'],
      threshold: 2,
      timeoutSeconds: 3600,
    });

    const escrow = await escrowService.createEscrow({
      projectId: 'proj-2',
      clientAddress: 'alice',
      freelancerAddress: 'freelancer-1',
      arbitratorAddresses: ['arb-1'],
      amount: '500',
      asset: 'XLM',
      network: 'stellar',
      deadline: Date.now() + 86400000,
      multisigPolicy: { groupId: group.id, threshold: 2, challengePeriodMs: 3600000 },
    });
    await escrowService.fundEscrow(escrow.id, 'tx-hash-2');

    await escrowService.createReleaseRequest(escrow.id, 'alice', 'refund_to_client');
    const result = await escrowService.approveReleaseRequest(escrow.id, 'bob', 'sig-bob');

    expect(result.approvals).toHaveLength(2);
    expect(result.status).toBe('pending');

    const updatedEscrow = await escrowService.getEscrow(escrow.id);
    expect(updatedEscrow?.status).toBe('funded');
  });

  it('rejects release request and blocks when enough rejections', async () => {
    const group = multisigService.createGroup({
      name: 'reject-signers',
      walletAddresses: ['alice', 'bob', 'charlie'],
      threshold: 2,
      timeoutSeconds: 3600,
    });

    const escrow = await escrowService.createEscrow({
      projectId: 'proj-3',
      clientAddress: 'alice',
      freelancerAddress: 'freelancer-1',
      arbitratorAddresses: ['arb-1'],
      amount: '500',
      asset: 'XLM',
      network: 'stellar',
      deadline: Date.now() + 86400000,
      multisigPolicy: { groupId: group.id, threshold: 2, challengePeriodMs: 0 },
    });
    await escrowService.fundEscrow(escrow.id, 'tx-hash-3');

    await escrowService.createReleaseRequest(escrow.id, 'alice', 'release_to_freelancer');

    await escrowService.rejectReleaseRequest(escrow.id, 'bob', 'sig-bob', 'not ready');
    await escrowService.rejectReleaseRequest(escrow.id, 'charlie', 'sig-charlie', 'bad idea');

    const request = escrowService.getReleaseRequest(escrow.id);
    expect(request?.status).toBe('rejected');
  });

  it('emits events on approval', async () => {
    const escrow = await setupEscrowWithMultisig();
    const events: string[] = [];
    escrowService.on('escrow:event', (event) => events.push(event.type));

    await escrowService.createReleaseRequest(escrow.id, 'alice', 'release_to_freelancer');
    await escrowService.approveReleaseRequest(escrow.id, 'bob', 'sig-bob');

    expect(events).toContain('escrow.release_request.created');
    expect(events).toContain('escrow.release_request.approval');
    expect(events).toContain('escrow.released');
  });

  it('prevents duplicate approvals from same signer', async () => {
    const escrow = await setupEscrowWithMultisig();
    await escrowService.createReleaseRequest(escrow.id, 'alice', 'release_to_freelancer');

    await expect(
      escrowService.approveReleaseRequest(escrow.id, 'alice', 'sig-again')
    ).rejects.toThrow('already approved');
  });

  it('prevents double release request', async () => {
    const escrow = await setupEscrowWithMultisig();
    await escrowService.createReleaseRequest(escrow.id, 'alice', 'release_to_freelancer');

    await expect(
      escrowService.createReleaseRequest(escrow.id, 'bob', 'release_to_freelancer')
    ).rejects.toThrow('A pending release request already exists');
  });

  it('executeReadyReleases processes all ready requests', async () => {
    const escrow = await setupEscrowWithMultisig();
    await escrowService.createReleaseRequest(escrow.id, 'alice', 'release_to_freelancer');
    await escrowService.approveReleaseRequest(escrow.id, 'bob', 'sig-bob');

    const executed = await escrowService.executeReadyReleases();
    expect(executed).toBe(0);
  });
});
