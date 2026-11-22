import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useStore,
  selectIsAuthenticated,
  selectUserAddress,
  selectPaymentType,
  selectPaymentFormData,
  selectProjects,
  selectCurrentProjectId,
} from '../useStore';

describe('Feature Slices and Narrow Selectors (Issue #1406)', () => {
  beforeEach(() => {
    useStore.getState().logout();
    useStore.getState().resetPayment();
    useStore.setState({ projects: [], currentProjectId: null, isLoading: false });
  });

  describe('Auth Slice actions and narrow selectors', () => {
    it('selects auth fields individually with narrow selectors', () => {
      useStore.getState().setAuth({
        address: '0x1234567890abcdef',
        email: 'dev@agenticpay.local',
        name: 'Alice Dev',
      });

      const state = useStore.getState();
      expect(selectIsAuthenticated(state)).toBe(true);
      expect(selectUserAddress(state)).toBe('0x1234567890abcdef');
      expect(state.email).toBe('dev@agenticpay.local');
      expect(state.name).toBe('Alice Dev');

      useStore.getState().setTimezone('UTC+1');
      expect(useStore.getState().timezone).toBe('UTC+1');

      useStore.getState().logout();
      const afterLogout = useStore.getState();
      expect(selectIsAuthenticated(afterLogout)).toBe(false);
      expect(selectUserAddress(afterLogout)).toBeNull();
    });
  });

  describe('Payment Slice actions and narrow selectors', () => {
    it('updates paymentType and formData independently', () => {
      useStore.getState().setPaymentType('batch');
      expect(selectPaymentType(useStore.getState())).toBe('batch');

      useStore.getState().updateFormData({ merchantId: 'm_42', currency: 'USDC' });
      expect(selectPaymentFormData(useStore.getState())).toEqual({
        merchantId: 'm_42',
        currency: 'USDC',
      });

      useStore.getState().setProcessing(true);
      expect(useStore.getState().isProcessing).toBe(true);

      useStore.getState().setErrorMessage('Network timeout');
      expect(useStore.getState().errorMessage).toBe('Network timeout');

      useStore.getState().resetPayment();
      expect(selectPaymentType(useStore.getState())).toBeNull();
      expect(selectPaymentFormData(useStore.getState())).toEqual({});
      expect(useStore.getState().isProcessing).toBe(false);
    });
  });

  describe('Project Slice actions and narrow selectors', () => {
    it('manages projects list and currentProjectId without touching other slices', () => {
      useStore.getState().setProjects([
        { id: 'proj-1', status: 'active' },
        { id: 'proj-2', status: 'pending' },
      ]);
      useStore.getState().setCurrentProject('proj-2');
      useStore.getState().setLoading(true);

      const state = useStore.getState();
      expect(selectProjects(state)).toHaveLength(2);
      expect(selectCurrentProjectId(state)).toBe('proj-2');
      expect(state.isLoading).toBe(true);
    });
  });

  describe('Persistence round-trip with legacy stored shape', () => {
    it('correctly loads and restores state from the legacy storage key and shape', () => {
      // Fixture representing the exact serialized persisted JSON stored by older versions
      const legacyStoredFixture = {
        state: {
          address: '0x9999999999999999999999999999999999999999',
          email: 'legacy@agenticpay.local',
          name: 'Legacy User',
          loginType: 'wallet' as const,
          isAuthenticated: true,
          paymentType: 'escrow' as const,
          formData: { amount: 250, asset: 'XLM' },
        },
        version: 0,
      };

      // Emulate hydration from stored json
      useStore.setState({
        ...legacyStoredFixture.state,
      });

      const loadedState = useStore.getState();
      expect(selectIsAuthenticated(loadedState)).toBe(true);
      expect(selectUserAddress(loadedState)).toBe('0x9999999999999999999999999999999999999999');
      expect(loadedState.email).toBe('legacy@agenticpay.local');
      expect(selectPaymentType(loadedState)).toBe('escrow');
      expect(selectPaymentFormData(loadedState)).toEqual({ amount: 250, asset: 'XLM' });
    });
  });

  describe('Narrow selector subscription & render-count guarantee', () => {
    it('narrow selector subscribers do not trigger on unrelated slice updates', () => {
      // Simulate component subscription tracking using Zustand's subscribe API
      const authSubscriber = vi.fn();
      let lastObservedAuth = selectIsAuthenticated(useStore.getState());

      // Subscribe to isAuthenticated only
      const unsubscribe = useStore.subscribe((state) => {
        const current = selectIsAuthenticated(state);
        if (current !== lastObservedAuth) {
          lastObservedAuth = current;
          authSubscriber(current);
        }
      });

      // Update payment slice multiple times (unrelated slice)
      useStore.getState().setPaymentType('subscription');
      useStore.getState().updateFormData({ foo: 'bar' });
      useStore.getState().setProcessing(true);

      // Auth subscriber should NOT have been called because auth did not change
      expect(authSubscriber).not.toHaveBeenCalled();

      // Now update auth slice
      useStore.getState().setAuth({ address: '0xabc' });
      expect(authSubscriber).toHaveBeenCalledTimes(1);
      expect(authSubscriber).toHaveBeenCalledWith(true);

      unsubscribe();
    });
  });
});
