// Conventional Commits policy for AgenticPay.
//
// Enforced in two places:
//   - locally by the `.husky/commit-msg` hook (installed by `npm install`)
//   - in CI by `.github/workflows/commitlint.yml`, which lints the PR title —
//     PRs are squash-merged, so the title becomes the commit on `main` that
//     semantic-release reads to pick the next version and write CHANGELOG.md.
//
// Behaviour is pinned by scripts/commitlint.test.mjs.

/** Types that appear in the changelog / drive a version bump, plus housekeeping. */
const TYPES = [
  'feat',
  'fix',
  'perf',
  'revert',
  'docs',
  'style',
  'refactor',
  'test',
  'build',
  'ci',
  'chore',
];

/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  helpUrl:
    'https://github.com/Smartdevs17/agenticpay/blob/main/CONTRIBUTING.md#commit-message-format',
  rules: {
    'type-enum': [2, 'always', TYPES],
    'subject-case': [2, 'never', ['upper-case']],
    'subject-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
    'subject-max-length': [2, 'always', 100],
    // Bodies regularly carry stack traces, URLs and generated release notes.
    'body-max-line-length': [2, 'always', 200],
  },
  ignores: [
    // Commits authored by semantic-release itself; their bodies are the
    // generated release notes and are not subject to the human policy.
    (message) => /^chore\(release\): \d+\.\d+\.\d+/.test(message),
  ],
  // Keep commitlint's built-in ignores (merge, revert, fixup!, squash!, ...).
  defaultIgnores: true,
};
