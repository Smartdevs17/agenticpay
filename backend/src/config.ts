/**
 * Grouped application config, derived from the single loader in
 * `config/env.ts` (Issue #1422). Validated when this module is first imported;
 * invalid settings stop the process with every problem listed.
 */
import { toAppConfig, validateEnv, type AppConfig } from './config/env.js';

export const config: AppConfig = toAppConfig(validateEnv());

export type Config = AppConfig;
