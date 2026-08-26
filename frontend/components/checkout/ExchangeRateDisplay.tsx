'use client';

import React, { useState, useEffect, useRef } from 'react';
import { api } from '@/frontend/lib/api';

interface ExchangeRateDisplayProps {
  sessionId: string;
  currency: string;
  onRateLocked?: (rate: number, expiresAt: string) => void;
  lockedRate?: {
    rate: number;
    expiresAt: string;
  };
}

export const ExchangeRateDisplay: React.FC<ExchangeRateDisplayProps> = ({
  sessionId,
  currency,
  onRateLocked,
  lockedRate,
}) => {
  const [rate, setRate] = useState<number | null>(null);
  const [prevRate, setPrevRate] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [locking, setLocking] = useState<boolean>(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Poll current rate from backend every 10 seconds unless rate is locked
  useEffect(() => {
    if (lockedRate) return;

    const fetchRate = async () => {
      try {
        const response = await api.checkout.getExchangeRates();
        const rates = response.data;
        const baseRate = rates[currency.toUpperCase()] || 1.0;
        const cryptoRate = rates['XLM'] || 0.12;
        const calculatedRate = Number((baseRate / cryptoRate).toFixed(6));

        setRate((prev) => {
          if (prev !== null && prev !== calculatedRate) {
            setPrevRate(prev);
          }
          return calculatedRate;
        });
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch exchange rates:', err);
      }
    };

    fetchRate();
    const interval = setInterval(fetchRate, 10000);

    return () => clearInterval(interval);
  }, [currency, lockedRate]);

  // Handle rate lock timer countdown
  useEffect(() => {
    if (!lockedRate) {
      setTimeLeft(0);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const calculateTimeLeft = () => {
      const diff = new Date(lockedRate.expiresAt).getTime() - Date.now();
      const seconds = Math.max(0, Math.floor(diff / 1000));
      setTimeLeft(seconds);

      if (seconds <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };

    calculateTimeLeft();
    timerRef.current = setInterval(calculateTimeLeft, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [lockedRate]);

  const handleLockRate = async () => {
    if (locking || lockedRate) return;
    setLocking(true);

    try {
      const response = await api.checkout.lockRate(sessionId);
      const updatedSession = response.data;
      if (updatedSession.lockedRate && onRateLocked) {
        onRateLocked(updatedSession.lockedRate.rate, updatedSession.lockedRate.expiresAt);
      }
    } catch (err) {
      console.error('Failed to lock exchange rate:', err);
    } finally {
      setLocking(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading && !lockedRate) {
    return (
      <div className="rate-widget">
        <div className="skeleton" style={{ height: '40px', width: '100%' }} />
      </div>
    );
  }

  const currentDisplayRate = lockedRate ? lockedRate.rate : rate;
  const isLocked = !!lockedRate;

  // Determine rate trajectory arrow
  const isUp = prevRate !== null && rate !== null && rate > prevRate;
  const isDown = prevRate !== null && rate !== null && rate < prevRate;

  return (
    <div className="rate-widget">
      <div className="rate-header">
        <div className="rate-ticker">
          <span>XLM / {currency}</span>
          {!isLocked && (
            <span className={`rate-arrow ${isUp ? 'up' : isDown ? 'down' : ''}`}>
              {isUp ? '▲' : isDown ? '▼' : '●'}
            </span>
          )}
        </div>
        <div className="rate-timer">
          {isLocked ? (
            <span style={{ color: 'var(--text-success)' }}>Rate Locked</span>
          ) : (
            <span>Live updates</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '24px', fontWeight: 800 }}>
          {currentDisplayRate?.toFixed(4)} <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{currency} / XLM</span>
        </div>
        
        {isLocked ? (
          <div className="rate-lock-btn locked">
            🔒 {formatTime(timeLeft)}
          </div>
        ) : (
          <button
            onClick={handleLockRate}
            disabled={locking}
            className="rate-lock-btn"
          >
            {locking ? 'Locking...' : '⚡ Lock Rate (5m)'}
          </button>
        )}
      </div>

      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
        {isLocked
          ? 'Guaranteed rate locked for transaction completion. Will auto-expire on timer.'
          : 'Exchange rates fluctuate. Lock rate to secure price during checkout.'}
      </div>
    </div>
  );
};
