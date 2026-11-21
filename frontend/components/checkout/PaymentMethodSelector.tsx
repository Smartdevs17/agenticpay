'use client';

import React from 'react';
import { CheckoutPaymentMethod } from '@/backend/src/services/checkout';
import { ExchangeRateDisplay } from './ExchangeRateDisplay';

interface PaymentMethodSelectorProps {
  sessionId: string;
  currency: string;
  amount: number;
  allowedMethods: CheckoutPaymentMethod[];
  selectedMethod?: CheckoutPaymentMethod;
  onMethodSelected: (method: CheckoutPaymentMethod) => void;
  lockedRate?: {
    rate: number;
    expiresAt: string;
  };
  onRateLocked?: (rate: number, expiresAt: string) => void;
  paymentDetails: {
    cardNumber?: string;
    cardExpiry?: string;
    cardCvc?: string;
    walletAddress?: string;
  };
  onDetailsChange: (details: any) => void;
}

export const PaymentMethodSelector: React.FC<PaymentMethodSelectorProps> = ({
  sessionId,
  currency,
  amount,
  allowedMethods,
  selectedMethod,
  onMethodSelected,
  lockedRate,
  onRateLocked,
  paymentDetails,
  onDetailsChange,
}) => {
  const getCryptoAmount = () => {
    if (lockedRate) {
      return (amount / lockedRate.rate).toFixed(4);
    }
    // Estimated amount based on default rate of 0.12 if not locked/polled yet
    return (amount / 0.12).toFixed(4);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onDetailsChange({ ...paymentDetails, [name]: value });
  };

  const estimatedFees = {
    crypto: '0.0001 XLM (~$0.00001)',
    card: `${new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount * 0.029 + 0.3)} (2.9% + $0.30)`,
    wallet: '0.0002 XLM (Network gas)',
  };

  return (
    <div>
      <div className="checkout-tabs">
        {allowedMethods.includes('crypto') && (
          <button
            type="button"
            className={`checkout-tab-btn ${selectedMethod === 'crypto' ? 'active' : ''}`}
            onClick={() => onMethodSelected('crypto')}
          >
            <span>🪙</span>
            <span>Crypto</span>
          </button>
        )}
        {allowedMethods.includes('card') && (
          <button
            type="button"
            className={`checkout-tab-btn ${selectedMethod === 'card' ? 'active' : ''}`}
            onClick={() => onMethodSelected('card')}
          >
            <span>💳</span>
            <span>Card / Fiat</span>
          </button>
        )}
        {allowedMethods.includes('wallet') && (
          <button
            type="button"
            className={`checkout-tab-btn ${selectedMethod === 'wallet' ? 'active' : ''}`}
            onClick={() => onMethodSelected('wallet')}
          >
            <span>🔌</span>
            <span>Wallet</span>
          </button>
        )}
      </div>

      <div style={{ minHeight: '260px' }}>
        {selectedMethod === 'crypto' && (
          <div>
            <ExchangeRateDisplay
              sessionId={sessionId}
              currency={currency}
              lockedRate={lockedRate}
              onRateLocked={onRateLocked}
            />

            <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="checkout-field">
                <label className="checkout-label">Crypto Wallet Address</label>
                <input
                  type="text"
                  name="walletAddress"
                  value={paymentDetails.walletAddress || ''}
                  onChange={handleInputChange}
                  placeholder="G..."
                  className="checkout-input"
                />
              </div>

              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <div style={{ background: 'white', padding: '8px', borderRadius: '8px', display: 'grid', placeItems: 'center' }}>
                  {/* Mock QR Code using external utility */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=stellar:${paymentDetails.walletAddress || 'GAJKW...'}`}
                    alt="Stellar QR Code"
                    style={{ width: '80px', height: '80px' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>Scan QR to Pay</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Send exactly <strong>{getCryptoAmount()} XLM</strong> to the address above.
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Stellar Network. Est fee: {estimatedFees.crypto}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedMethod === 'card' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="checkout-field">
              <label className="checkout-label">Cardholder Name</label>
              <input
                type="text"
                placeholder="John Doe"
                className="checkout-input"
              />
            </div>

            <div className="checkout-field">
              <label className="checkout-label">Card Number</label>
              <input
                type="text"
                name="cardNumber"
                value={paymentDetails.cardNumber || ''}
                onChange={handleInputChange}
                placeholder="4242 4242 4242 4242"
                className="checkout-input"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="checkout-field">
                <label className="checkout-label">Expiration Date</label>
                <input
                  type="text"
                  name="cardExpiry"
                  value={paymentDetails.cardExpiry || ''}
                  onChange={handleInputChange}
                  placeholder="MM/YY"
                  className="checkout-input"
                />
              </div>
              <div className="checkout-field">
                <label className="checkout-label">CVC</label>
                <input
                  type="password"
                  name="cardCvc"
                  value={paymentDetails.cardCvc || ''}
                  onChange={handleInputChange}
                  placeholder="123"
                  className="checkout-input"
                />
              </div>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              🔒 Secured Stripe Elements. Processing fees apply: {estimatedFees.card}
            </div>
          </div>
        )}

        {selectedMethod === 'wallet' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔌</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>Connect Web3 Wallet</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '0 0 24px', lineHeight: 1.5 }}>
              Connect your Stellar Albedo, Rabe, or WalletConnect-compatible wallet to proceed with single-click checkout.
            </p>
            
            <button
              type="button"
              className="checkout-btn"
              onClick={() => onDetailsChange({ ...paymentDetails, walletAddress: 'GDXW3Z3V3...CONNECT' })}
            >
              Connect Wallet
            </button>
            
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '16px' }}>
              Est Network Gas fee: {estimatedFees.wallet}
            </div>
          </div>
        )}

        {!selectedMethod && (
          <div style={{ display: 'grid', placeItems: 'center', minHeight: '260px', color: 'var(--text-muted)', border: '1px dashed var(--glass-border)', borderRadius: '12px' }}>
            Select a payment method above to complete your order
          </div>
        )}
      </div>
    </div>
  );
};
