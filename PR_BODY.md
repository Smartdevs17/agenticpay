Summary

This PR implements four related enhancements:

- Add print-friendly views for reports (print CSS tweaks and report card classes)
- Build a minimal onboarding wizard for new users (`frontend/src/domains/onboarding/page.tsx`)
- Implement safer multi-stage Dockerfiles for backend and frontend (use non-root runtime user)
- Add a GitHub Actions workflow to validate Docker builds on pull requests

Changes

- Updated `frontend/app/[locale]/dashboard/tax-reports/page.tsx` to include print-friendly classes.
- Updated `frontend/app/globals.css` to improve print styles for reports.
- Added `frontend/src/domains/onboarding/page.tsx` as a lightweight onboarding wizard.
- Updated `Dockerfile.backend` and `Dockerfile.frontend` to ensure non-root runtime user and keep multi-stage build structure.
- Added `.github/workflows/docker-build.yml` to validate Docker image builds on PRs.

Testing

- Frontend lint and tests:

  cd frontend
  npm ci
  npm run lint
  npm test

- To validate Docker builds locally:

  docker build -f Dockerfile.backend -t agenticpay/backend:pr-839 .
  docker build -f Dockerfile.frontend -t agenticpay/frontend:pr-839 .

Closes

closes #836
closes #837
closes #839
closes #838
