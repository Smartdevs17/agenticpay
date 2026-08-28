import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../useStore';

// Regression test for the zustand slices pattern: `createAuthSlice` /
// `createPaymentSlice` / `createProjectSlice` used to call `set(...)`
// without ever receiving it as a parameter, so every action threw
// `ReferenceError: set is not defined` the moment it was invoked.

describe('useStore (auth/payment/project slices)', () => {
  beforeEach(() => {
    useStore.setState({
      address: null,
      email: undefined,
      name: undefined,
      profileImage: undefined,
      timezone: undefined,
      loginType: null,
      isAuthenticated: false,
      paymentType: null,
      formData: {},
      isProcessing: false,
      errorMessage: null,
      projects: [],
      currentProjectId: null,
      isLoading: false,
    });
  });

  it('setAuth updates auth state without throwing', () => {
    expect(() =>
      useStore.getState().setAuth({ address: '0xabc', loginType: 'wallet' }),
    ).not.toThrow();

    const state = useStore.getState();
    expect(state.address).toBe('0xabc');
    expect(state.loginType).toBe('wallet');
    expect(state.isAuthenticated).toBe(true);
  });

  it('logout resets auth state', () => {
    useStore.getState().setAuth({ address: '0xabc', loginType: 'wallet' });
    useStore.getState().logout();

    const state = useStore.getState();
    expect(state.address).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('payment slice actions merge formData and update processing state', () => {
    useStore.getState().setPaymentType('escrow');
    useStore.getState().updateFormData({ amount: 100 });
    useStore.getState().updateFormData({ recipient: 'freelancer-1' });
    useStore.getState().setProcessing(true);

    const state = useStore.getState();
    expect(state.paymentType).toBe('escrow');
    expect(state.formData).toEqual({ amount: 100, recipient: 'freelancer-1' });
    expect(state.isProcessing).toBe(true);
  });

  it('project slice actions update the project list and current selection', () => {
    useStore.getState().setProjects([{ id: 'p1', status: 'created' }]);
    useStore.getState().setCurrentProject('p1');
    useStore.getState().setLoading(true);

    const state = useStore.getState();
    expect(state.projects).toEqual([{ id: 'p1', status: 'created' }]);
    expect(state.currentProjectId).toBe('p1');
    expect(state.isLoading).toBe(true);
  });
});
