# Contract Templates

Contracts are generated from two kinds of templates, both in
`src/templates/contracts.ts`.

## Contract templates

`CONTRACT_TEMPLATES` holds the clauses for each contract type: `service`,
`milestone`, `nda`, `employment`, `licensing` and `custom`. Clause bodies use
`{{snake_case}}` placeholders.

When a contract is generated, each placeholder is filled from the project
config. A camelCase config key fills the matching placeholder, so
`companyName` fills `{{company_name}}`. If the config has no value, a built in
default is used where one exists (for example `payment_terms` defaults to
`Net 30`). Placeholders that stay empty are left in the text and listed in
`contract.metadata.unresolvedPlaceholders`, and a
`[contracts] unresolved placeholders` warning is logged.

## Project configuration templates

`PROJECT_CONFIG_TEMPLATES` are ready-made project setups. Each one picks a
contract type, supplies defaults and lists the fields the caller still has to
provide.

| Id | Contract type | Required fields |
|---|---|---|
| `fixed-price-build` | service | name, scope, budget, currency, clientName, freelancerName |
| `milestone-delivery` | milestone | name, scope, budget, currency, milestones |
| `mutual-nda` | nda | name, clientName, freelancerName |
| `software-license` | licensing | softwareName, licensorName, licenseeName, licenseFee, currency |

```ts
import { generateContractFromTemplate } from '../services/contracts.js';

const contract = generateContractFromTemplate({
  templateId: 'milestone-delivery',
  projectId: 'proj_1',
  clientId: 'client_1',
  freelancerId: 'freelancer_1',
  createdBy: 'user_1',
  overrides: {
    name: 'Mobile app',
    scope: 'iOS and Android client',
    budget: 9000,
    currency: 'USDC',
    milestones: [{ title: 'Design' }, { title: 'Build' }],
  },
});
```

Overrides win over template defaults. Generation throws
`ContractTemplateError` when the template id is unknown, when a required field
is missing (`error.missingFields` lists them; empty strings and empty lists
count as missing), or when a party id is missing. The generated contract
records `metadata.templateId`, and every generation is logged as
`[contracts] generated`.

Use `listProjectConfigTemplates()` and `getProjectConfigTemplate(id)` to show
the available templates.

## Adding a template

1. Add an entry to `PROJECT_CONFIG_TEMPLATES` with a unique id, a
   `contractType` that exists in `CONTRACT_TEMPLATES`, defaults and required
   fields.
2. Add a test in `src/services/__tests__/contract-templates.test.ts` that
   generates it and checks `metadata.unresolvedPlaceholders` is empty.
