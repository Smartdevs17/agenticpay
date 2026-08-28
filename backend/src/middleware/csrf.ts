import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";

export interface CsrfConfig {
  cookieMaxAge?: number;
  cookieHttpOnly?: boolean;
  cookieSecure?: boolean;
  cookieSameSite?: "strict" | "lax" | "none";
  excludedMethods?: string[];
  excludedPaths?: string[];
}

const defaultConfig: Required<CsrfConfig> = {
  cookieMaxAge: 3600000,
  cookieHttpOnly: true,
  cookieSecure: process.env.NODE_ENV === "production",
  cookieSameSite: "strict",
  excludedMethods: ["GET", "HEAD", "OPTIONS"],
  excludedPaths: ["/health", "/metrics"],
};

function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
}

function isExcludedPath(path: string, excludedPaths: string[]): boolean {
  return excludedPaths.some((excluded) => path.startsWith(excluded));
}

export function csrfProtection(config: CsrfConfig = {}) {
  const finalConfig = { ...defaultConfig, ...config };

  return (req: Request, res: Response, next: NextFunction): void => {
    if (isExcludedPath(req.path, finalConfig.excludedPaths)) {
      return next();
    }

    let csrfToken = req.cookies?.[CSRF_COOKIE_NAME];

    if (!csrfToken) {
      csrfToken = generateCsrfToken();
      res.cookie(CSRF_COOKIE_NAME, csrfToken, {
        maxAge: finalConfig.cookieMaxAge,
        httpOnly: finalConfig.cookieHttpOnly,
        secure: finalConfig.cookieSecure,
        sameSite: finalConfig.cookieSameSite,
      });
    }

    res.locals.csrfToken = csrfToken;

    if (finalConfig.excludedMethods.includes(req.method)) {
      return next();
    }

    const submittedToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

    if (!submittedToken) {
      res.status(403).json({
        error: "CSRF token missing",
        message: "CSRF token is required in request header",
      });
      return;
    }

    if (submittedToken !== csrfToken) {
      res.status(403).json({
        error: "CSRF token invalid",
        message: "CSRF token does not match",
      });
      return;
    }

    next();
  };
}

export function getCsrfToken(req: Request, res: Response): void {
  const token = res.locals.csrfToken || req.cookies?.[CSRF_COOKIE_NAME];

  if (!token) {
    const newToken = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, newToken, {
      maxAge: defaultConfig.cookieMaxAge,
      httpOnly: defaultConfig.cookieHttpOnly,
      secure: defaultConfig.cookieSecure,
      sameSite: defaultConfig.cookieSameSite,
    });
    res.json({ csrfToken: newToken });
  } else {
    res.json({ csrfToken: token });
  }
}
