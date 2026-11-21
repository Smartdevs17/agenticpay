export default {
  testRunner: 'vitest',
  reporters: ['clear-text', 'html', 'json'],
  mutate: ['src/middleware/queryLogger.ts', 'src/config/database.ts'],
  testMatch: ['src/**/*.test.ts'],
  coverageAnalysis: 'off',
  thresholds: { high: 80, low: 60, break: 0 },
  tempDirName: '.stryker-tmp',
};