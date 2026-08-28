import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../useStore';

describe('useStore (slices pattern)', () => {
  beforeEach(() => {
    useStore.getState().logout();
    useStore.getState().resetPayment();
    useStore.setState({ projects: [], currentProjectId: null, isLoading: false });
  });

  it('auth slice: setAuth updates state and marks authenticated', () => {
    useStore.getState().setAuth({ address: '0xabc', name: 'Ada' });
    const state = useStore.getState();
    expect(state.address).toBe('0xabc');
    expect(state.name).toBe('Ada');
    expect(state.isAuthenticated).toBe(true);
  });

  it('auth slice: logout clears auth fields', () => {
    useStore.getState().setAuth({ address: '0xabc' });
    useStore.getState().logout();
    const state = useStore.getState();
    expect(state.address).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('payment slice: updateFormData merges into existing formData', () => {
    useStore.getState().setPaymentType('escrow');
    useStore.getState().updateFormData({ amount: 100 });
    useStore.getState().updateFormData({ currency: 'USDC' });
    const state = useStore.getState();
    expect(state.paymentType).toBe('escrow');
    expect(state.formData).toEqual({ amount: 100, currency: 'USDC' });
  });

  it('project slice: setProjects and setCurrentProject operate independently of other slices', () => {
    useStore.getState().setAuth({ address: '0xabc' });
    useStore.getState().setProjects([{ id: 'p1', status: 'open' }]);
    useStore.getState().setCurrentProject('p1');

    const state = useStore.getState();
    expect(state.projects).toEqual([{ id: 'p1', status: 'open' }]);
    expect(state.currentProjectId).toBe('p1');
    // Unrelated slices remain untouched
    expect(state.address).toBe('0xabc');
  });
});
