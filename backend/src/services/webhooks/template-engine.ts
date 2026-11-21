export interface WebhookTemplate {
  id: string;
  merchantId: string;
  name: string;
  template: string;
  version: number;
  createdAt: Date;
}

export function renderTemplate(template: string, data: any): string {
  try {
    let result = template;

    // 1. Helpers
    // Helper: formatCurrency
    result = result.replace(/\{\{\s*formatCurrency\s+([^}]+)\}\}/g, (match, field) => {
      const val = getValueByPath(data, field.trim());
      if (val === undefined || val === null) return '';
      const num = typeof val === 'number' ? val : parseFloat(val);
      if (isNaN(num)) return String(val);
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
    });

    // Helper: dateFormat
    result = result.replace(/\{\{\s*dateFormat\s+([^}]+)\}\}/g, (match, field) => {
      const val = getValueByPath(data, field.trim());
      if (!val) return '';
      const date = new Date(val);
      if (isNaN(date.getTime())) return String(val);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    });

    // 2. Conditionals: {{#if condition}} ... {{/if}}
    const ifRegex = /\{\{\s*#if\s+([^}]+)\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g;
    let match;
    while ((match = ifRegex.exec(result)) !== null) {
      const conditionPath = match[1].trim();
      const content = match[2];
      const conditionValue = getValueByPath(data, conditionPath);
      const replacement = conditionValue ? content : '';
      result = result.replace(match[0], replacement);
      ifRegex.lastIndex = 0; // Reset regex to re-evaluate from start
    }

    // 3. Loops: {{#each array}} ... {{/each}}
    const eachRegex = /\{\{\s*#each\s+([^}]+)\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g;
    while ((match = eachRegex.exec(result)) !== null) {
      const arrayPath = match[1].trim();
      const content = match[2];
      const arrayVal = getValueByPath(data, arrayPath);
      let replacement = '';
      if (Array.isArray(arrayVal)) {
        replacement = arrayVal.map(item => {
          return content.replace(/\{\{\s*this\s*\}\}/g, String(item))
                        .replace(/\{\{\s*([^}]+)\}\}/g, (m, f) => {
                          const itemVal = typeof item === 'object' ? getValueByPath(item, f.trim()) : item;
                          return itemVal !== undefined ? String(itemVal) : '';
                        });
        }).join('');
      }
      result = result.replace(match[0], replacement);
      eachRegex.lastIndex = 0;
    }

    // 4. Variables: {{variable}}
    result = result.replace(/\{\{\s*([^}]+)\}\}/g, (match, field) => {
      const val = getValueByPath(data, field.trim());
      return val !== undefined && val !== null ? String(val) : '';
    });

    return result;
  } catch (err) {
    throw new Error('Template rendering failed: ' + (err as Error).message);
  }
}

function getValueByPath(obj: any, path: string): any {
  if (path === 'this') return obj;
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

export function validateTemplate(template: string): boolean {
  const openIfs = (template.match(/\{\{\s*#if/g) || []).length;
  const closeIfs = (template.match(/\{\{\s*\/if\s*\}\}/g) || []).length;
  const openEachs = (template.match(/\{\{\s*#each/g) || []).length;
  const closeEachs = (template.match(/\{\{\s*\/each\s*\}\}/g) || []).length;

  if (openIfs !== closeIfs) {
    throw new Error(`Mismatched #if block: opened ${openIfs} times but closed ${closeIfs} times.`);
  }
  if (openEachs !== closeEachs) {
    throw new Error(`Mismatched #each block: opened ${openEachs} times but closed ${closeEachs} times.`);
  }
  return true;
}

export class WebhookTemplateService {
  private templates: Map<string, WebhookTemplate[]> = new Map();

  async createTemplate(merchantId: string, name: string, templateStr: string): Promise<WebhookTemplate> {
    validateTemplate(templateStr);
    const id = Math.random().toString(36).substring(7);
    const newTemplate: WebhookTemplate = {
      id,
      merchantId,
      name,
      template: templateStr,
      version: 1,
      createdAt: new Date(),
    };
    const merchantTemplates = this.templates.get(merchantId) || [];
    merchantTemplates.push(newTemplate);
    this.templates.set(merchantId, merchantTemplates);
    return newTemplate;
  }

  async updateTemplate(merchantId: string, id: string, templateStr: string): Promise<WebhookTemplate> {
    validateTemplate(templateStr);
    const merchantTemplates = this.templates.get(merchantId) || [];
    const templateIndex = merchantTemplates.findIndex(t => t.id === id);
    if (templateIndex === -1) {
      throw new Error('Template not found');
    }
    const current = merchantTemplates[templateIndex];
    const updated: WebhookTemplate = {
      ...current,
      template: templateStr,
      version: current.version + 1,
    };
    merchantTemplates[templateIndex] = updated;
    this.templates.set(merchantId, merchantTemplates);
    return updated;
  }

  async deleteTemplate(merchantId: string, id: string): Promise<boolean> {
    const merchantTemplates = this.templates.get(merchantId) || [];
    const filtered = merchantTemplates.filter(t => t.id !== id);
    if (filtered.length === merchantTemplates.length) {
      return false;
    }
    this.templates.set(merchantId, filtered);
    return true;
  }

  async getTemplate(merchantId: string, id: string): Promise<WebhookTemplate | null> {
    const merchantTemplates = this.templates.get(merchantId) || [];
    return merchantTemplates.find(t => t.id === id) || null;
  }

  previewRender(templateStr: string, sampleData: any): string {
    try {
      validateTemplate(templateStr);
      return renderTemplate(templateStr, sampleData);
    } catch (err) {
      return JSON.stringify(sampleData);
    }
  }
}
