import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, Code2, ExternalLink, FileJson, Terminal } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Developer Portal | AgenticPay',
  description:
    'Explore the AgenticPay API playground, OpenAPI specification, and official SDKs for TypeScript, Python, and Go.',
};

const GITHUB_REPO = 'https://github.com/Smartdevs17/agenticpay';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
// The interactive docs/playground are served from the API origin, outside of /api/v1.
const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '');
const PLAYGROUND_URL = `${API_ORIGIN}/docs`;
const OPENAPI_SPEC_URL = `${API_ORIGIN}/docs/openapi.json`;

interface Sdk {
  language: string;
  install: string;
  packagePath: string;
}

const SDKS: Sdk[] = [
  { language: 'TypeScript', install: 'npm install @agenticpay/sdk', packagePath: 'packages/sdk' },
  { language: 'Python', install: 'pip install agenticpay', packagePath: 'sdks/python' },
  { language: 'Go', install: 'go get github.com/Smartdevs17/agenticpay-sdk-go', packagePath: 'sdks/go' },
];

interface Guide {
  title: string;
  description: string;
  file: string;
}

const GUIDES: Guide[] = [
  { title: 'SDK overview', description: 'Available SDKs, quick start, and authentication.', file: 'docs/sdk/README.md' },
  { title: 'Migrating from REST', description: 'Move from raw REST calls to the typed SDKs.', file: 'docs/sdk/MIGRATION-FROM-REST.md' },
  { title: 'Error handling', description: 'The SDK error hierarchy and how to handle it.', file: 'docs/sdk/ERROR-HANDLING.md' },
  { title: 'Testing', description: 'Mocking and testing code that uses the SDKs.', file: 'docs/sdk/TESTING.md' },
  { title: 'Versioning', description: 'SDK release and API versioning policy.', file: 'docs/sdk/VERSIONING.md' },
];

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <main className="pt-20 pb-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-xl shadow-blue-100/60 backdrop-blur-sm">
              <div className="border-b border-slate-100 bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-600 px-6 py-12 text-white sm:px-10">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium">
                  <Code2 className="h-4 w-4" />
                  Developer Portal
                </div>
                <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
                  Build on AgenticPay
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-blue-50 sm:text-lg">
                  Explore the API in an interactive playground, browse the OpenAPI specification,
                  and get started with an official SDK.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a
                    href={PLAYGROUND_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-50"
                  >
                    <Terminal className="h-4 w-4" />
                    Open API playground
                  </a>
                  <a
                    href={OPENAPI_SPEC_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/25"
                  >
                    <FileJson className="h-4 w-4" />
                    OpenAPI spec (JSON)
                  </a>
                </div>
              </div>

              <div className="space-y-12 px-6 py-10 sm:px-10 sm:py-12">
                <section aria-labelledby="sdks-heading">
                  <h2 id="sdks-heading" className="text-2xl font-semibold tracking-tight text-slate-900">
                    Official SDKs
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Typed clients for the AgenticPay API, published from this repository.
                  </p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-3">
                    {SDKS.map((sdk) => (
                      <div
                        key={sdk.language}
                        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                      >
                        <h3 className="text-base font-semibold text-slate-900">{sdk.language}</h3>
                        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
                          <code>{sdk.install}</code>
                        </pre>
                        <Link
                          href={`${GITHUB_REPO}/tree/main/${sdk.packagePath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                        >
                          View source
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    ))}
                  </div>
                </section>

                <section aria-labelledby="guides-heading">
                  <h2 id="guides-heading" className="text-2xl font-semibold tracking-tight text-slate-900">
                    Guides
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Reference documentation for integrating with the AgenticPay SDKs and API.
                  </p>
                  <ul className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                    {GUIDES.map((guide) => (
                      <li key={guide.file}>
                        <Link
                          href={`${GITHUB_REPO}/blob/main/${guide.file}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
                        >
                          <span className="flex items-start gap-3">
                            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                            <span>
                              <span className="block text-sm font-medium text-slate-900">
                                {guide.title}
                              </span>
                              <span className="block text-sm text-slate-500">{guide.description}</span>
                            </span>
                          </span>
                          <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
