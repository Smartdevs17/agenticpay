import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { deprecationMiddleware } from '../deprecation.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
    return {
        method: 'GET',
        originalUrl: '/api/v1/test',
        ip: '127.0.0.1',
        headers: {},
        ...overrides,
    } as unknown as Request;
}

function makeRes(): {
    res: Response;
    headers: Record<string, string | string[] | number>;
} {
    const headers: Record<string, string | string[] | number> = {};

    const res = {
        setHeader: vi.fn((name: string, value: string | string[] | number) => {
            headers[name] = value;
        }),
        getHeader: vi.fn((name: string) => {
            return headers[name];
        }),
    } as unknown as Response;

    return { res, headers };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deprecationMiddleware()', () => {
    let next: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        next = vi.fn();
        // Mock console.warn to avoid cluttering test output
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    it('sets Deprecation header', () => {
        const req = makeReq();
        const { res, headers } = makeRes();
        const deprecationDate = '2023-12-31';
        const mw = deprecationMiddleware({ deprecationDate });

        mw(req, res, next);

        expect(headers['Deprecation']).toBe(new Date(deprecationDate).toUTCString());
        expect(next).toHaveBeenCalledOnce();
    });

    it('sets Sunset header when provided', () => {
        const req = makeReq();
        const { res, headers } = makeRes();
        const deprecationDate = '2023-10-01';
        const sunsetDate = '2024-03-31';
        const mw = deprecationMiddleware({ deprecationDate, sunsetDate });

        mw(req, res, next);

        expect(headers['Deprecation']).toBe(new Date(deprecationDate).toUTCString());
        expect(headers['Sunset']).toBe(new Date(sunsetDate).toUTCString());
    });

    it('sets Link header for successor-version', () => {
        const req = makeReq();
        const { res, headers } = makeRes();
        const alternativeUrl = 'https://api.example.com/v2';
        const mw = deprecationMiddleware({
            deprecationDate: '2023-01-01',
            alternativeUrl
        });

        mw(req, res, next);

        expect(headers['Link']).toBe(`<${alternativeUrl}>; rel="successor-version"`);
    });

    it('appends to existing Link header', () => {
        const req = makeReq();
        const { res, headers } = makeRes();

        // Set existing Link header
        const existingLink = '<https://docs.example.com>; rel="help"';
        res.setHeader('Link', existingLink);

        const alternativeUrl = 'https://api.example.com/v2';
        const mw = deprecationMiddleware({
            deprecationDate: '2023-01-01',
            alternativeUrl
        });

        mw(req, res, next);

        const linkHeader = headers['Link'];
        expect(Array.isArray(linkHeader)).toBe(true);
        expect(linkHeader).toContain(existingLink);
        expect(linkHeader).toContain(`<${alternativeUrl}>; rel="successor-version"`);
    });

    it('logs a warning with request details', () => {
        const req = makeReq({ method: 'POST', originalUrl: '/api/v1/old-endpoint' });
        const { res } = makeRes();
        const deprecationDate = '2023-06-01';
        const mw = deprecationMiddleware({ deprecationDate });

        mw(req, res, next);

        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('[DEPRECATION WARNING]')
        );
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('POST')
        );
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/old-endpoint')
        );
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining(deprecationDate)
        );
    });
});
