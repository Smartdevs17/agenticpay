import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigureStep } from '../ConfigureStep';
import { SelectTypeStep } from '../SelectTypeStep';
import { useWizardStore } from '@/store/wizard-store';

describe('tip flow', () => {
  beforeEach(() => {
    useWizardStore.getState().reset();
  });

  it('allows selecting a tip donation option from the payment type picker', () => {
    render(<SelectTypeStep />);

    const tipOption = screen.getByRole('button', { name: /tip/i });
    fireEvent.click(tipOption);

    expect(useWizardStore.getState().paymentType).toBe('tip');
  });

  it('shows quick tip amount presets for tip donations', () => {
    useWizardStore.setState({ paymentType: 'tip' });

    render(<ConfigureStep />);

    expect(screen.getByText('Suggested tip amounts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '$5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '$10' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '$25' })).toBeInTheDocument();
  });
});
