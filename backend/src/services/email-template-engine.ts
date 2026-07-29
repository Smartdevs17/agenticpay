// Email Template Engine Service
// Handlebars-style template rendering with localization support

import Handlebars from 'handlebars';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPONENTS_DIR = join(__dirname, '..', 'templates', 'components');

export interface TemplateVariable {
  name: string;
  required: boolean;
  defaultValue?: any;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
}

export interface TemplateContext {
  [key: string]: any;
}

export interface RenderedTemplate {
  subject: string;
  htmlBody: string;
  textBody: string;
  missingVariables: string[];
}

export class EmailTemplateEngine {
  private handlebars: typeof Handlebars;

  constructor() {
    this.handlebars = Handlebars.create();
    this.registerHelpers();
    this.registerComponents();
  }

  /**
   * Register every .hbs file in templates/components/ (header, footer,
   * button, layout, ...) as a reusable Handlebars partial, keyed by
   * filename. Lets templates opt into shared components via `{{> header}}`.
   */
  private registerComponents(): void {
    let files: string[] = [];
    try {
      files = readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith('.hbs'));
    } catch {
      return; // components dir is optional in some deployments (e.g. bundled builds)
    }
    for (const file of files) {
      const name = basename(file, '.hbs');
      const source = readFileSync(join(COMPONENTS_DIR, file), 'utf-8');
      this.handlebars.registerPartial(name, source);
    }
  }

  /**
   * Renders `contentHtml` as a standalone component, then injects the
   * result into the shared `layout` partial (header/footer chrome) — the
   * template-inheritance pattern: layout owns the shell, callers only
   * supply body content and get consistent chrome for free.
   */
  renderWithLayout(contentHtml: string, context: TemplateContext): string {
    const body = this.render(contentHtml, context);
    const layoutSource = this.handlebars.partials['layout'] as string;
    return this.render(layoutSource, {
      currentYear: new Date().getFullYear(),
      unsubscribeUrl: '#',
      ...context,
      body: new this.handlebars.SafeString(body),
    });
  }

  /**
   * Register custom Handlebars helpers
   */
  private registerHelpers(): void {
    // Format date
    this.handlebars.registerHelper('formatDate', (date: Date | string, format: string = 'YYYY-MM-DD') => {
      if (!date) return '';
      const d = typeof date === 'string' ? new Date(date) : date;
      return d.toLocaleDateString();
    });

    // Format currency
    this.handlebars.registerHelper('formatCurrency', (amount: number, currency: string = 'USD') => {
      if (typeof amount !== 'number') return '';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
      }).format(amount);
    });

    // Format number
    this.handlebars.registerHelper('formatNumber', (num: number, decimals: number = 2) => {
      if (typeof num !== 'number') return '';
      return num.toFixed(decimals);
    });

    // Conditional equals
    this.handlebars.registerHelper('eq', (a: any, b: any) => a === b);

    // Conditional not equals
    this.handlebars.registerHelper('ne', (a: any, b: any) => a !== b);

    // Conditional greater than
    this.handlebars.registerHelper('gt', (a: number, b: number) => a > b);

    // Conditional less than
    this.handlebars.registerHelper('lt', (a: number, b: number) => a < b);

    // Default value
    this.handlebars.registerHelper('default', (value: any, defaultValue: any) => {
      return value !== undefined && value !== null && value !== '' ? value : defaultValue;
    });

    // Truncate text
    this.handlebars.registerHelper('truncate', (str: string, length: number = 100) => {
      if (!str) return '';
      if (str.length <= length) return str;
      return str.substring(0, length) + '...';
    });

    // Uppercase
    this.handlebars.registerHelper('uppercase', (str: string) => {
      if (!str) return '';
      return str.toUpperCase();
    });

    // Lowercase
    this.handlebars.registerHelper('lowercase', (str: string) => {
      if (!str) return '';
      return str.toLowerCase();
    });

    // JSON stringify
    this.handlebars.registerHelper('json', (obj: any) => {
      return JSON.stringify(obj);
    });

    // URL encoding
    this.handlebars.registerHelper('urlencode', (str: string) => {
      if (!str) return '';
      return encodeURIComponent(str);
    });

    // Array length
    this.handlebars.registerHelper('length', (arr: any[]) => {
      if (!Array.isArray(arr)) return 0;
      return arr.length;
    });

    // First item in array
    this.handlebars.registerHelper('first', (arr: any[]) => {
      if (!Array.isArray(arr) || arr.length === 0) return '';
      return arr[0];
    });

    // Last item in array
    this.handlebars.registerHelper('last', (arr: any[]) => {
      if (!Array.isArray(arr) || arr.length === 0) return '';
      return arr[arr.length - 1];
    });

    // Join array
    this.handlebars.registerHelper('join', (arr: any[], separator: string = ', ') => {
      if (!Array.isArray(arr)) return '';
      return arr.join(separator);
    });
  }

  /**
   * Extract variables from template
   */
  extractVariables(template: string): string[] {
    const variableRegex = /\{\{([^}]+)\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = variableRegex.exec(template)) !== null) {
      const variable = match[1].trim();
      // Remove Handlebars helpers and operators
      const cleanVar = variable.split(/\s+/)[0];
      if (cleanVar && !cleanVar.startsWith('#') && !cleanVar.startsWith('/')) {
        variables.add(cleanVar);
      }
    }

    return Array.from(variables);
  }

  /**
   * Validate template syntax
   */
  validateTemplate(template: string): { valid: boolean; error?: string } {
    try {
      this.handlebars.compile(template);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown template error',
      };
    }
  }

  /**
   * Render template with context
   */
  render(template: string, context: TemplateContext): string {
    try {
      const compiledTemplate = this.handlebars.compile(template);
      return compiledTemplate(context);
    } catch (error) {
      console.error('[TemplateEngine] Render error:', error);
      throw new Error(`Template rendering failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Render email template (subject, html, text)
   */
  renderEmail(
    subject: string,
    htmlBody: string,
    textBody: string | null,
    context: TemplateContext
  ): RenderedTemplate {
    const allVariables = new Set<string>();
    
    // Extract variables from all parts
    this.extractVariables(subject).forEach(v => allVariables.add(v));
    this.extractVariables(htmlBody).forEach(v => allVariables.add(v));
    if (textBody) {
      this.extractVariables(textBody).forEach(v => allVariables.add(v));
    }

    // Check for missing required variables
    const missingVariables: string[] = [];
    for (const variable of allVariables) {
      if (context[variable] === undefined || context[variable] === null) {
        missingVariables.push(variable);
      }
    }

    // Render all parts
    const renderedSubject = this.render(subject, context);
    const renderedHtmlBody = this.render(htmlBody, context);
    const renderedTextBody = textBody ? this.render(textBody, context) : '';

    return {
      subject: renderedSubject,
      htmlBody: renderedHtmlBody,
      textBody: renderedTextBody,
      missingVariables,
    };
  }

  /**
   * Preview template with sample data
   */
  previewTemplate(
    template: string,
    sampleData: TemplateContext = {}
  ): { rendered: string; variables: string[] } {
    const variables = this.extractVariables(template);
    const rendered = this.render(template, sampleData);
    return { rendered, variables };
  }

  /**
   * Add custom helper
   */
  registerHelper(name: string, fn: (...args: any[]) => any): void {
    this.handlebars.registerHelper(name, fn);
  }

  /**
   * Remove helper
   */
  unregisterHelper(name: string): void {
    this.handlebars.unregisterHelper(name);
  }
}

export default EmailTemplateEngine;
