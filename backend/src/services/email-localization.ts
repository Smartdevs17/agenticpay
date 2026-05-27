// Email Localization Service
// Manages template translations and locale-specific content

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface LocalizedTemplate {
  templateId: string;
  locale: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

export interface TemplateWithLocalizations {
  id: string;
  name: string;
  category: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  variables: string[];
  locale: string;
  localizations: LocalizedTemplate[];
}

export class EmailLocalizationService {
  /**
   * Get template with localizations
   */
  async getTemplateWithLocalizations(templateId: string): Promise<TemplateWithLocalizations | null> {
    const template = await prisma.emailTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return null;
    }

    const localizations = await prisma.emailTemplateLocalization.findMany({
      where: { templateId },
    });

    return {
      id: template.id,
      name: template.name,
      category: template.category,
      subject: template.subject,
      htmlBody: template.htmlBody,
      textBody: template.textBody || undefined,
      variables: template.variables,
      locale: template.locale,
      localizations: localizations.map((l) => ({
        templateId: l.templateId,
        locale: l.locale,
        subject: l.subject,
        htmlBody: l.htmlBody,
        textBody: l.textBody || undefined,
      })),
    };
  }

  /**
   * Get template for specific locale
   */
  async getTemplateForLocale(templateId: string, locale: string): Promise<{
    subject: string;
    htmlBody: string;
    textBody?: string;
  } | null> {
    // First try to find localization
    const localization = await prisma.emailTemplateLocalization.findUnique({
      where: {
        templateId_locale: {
          templateId,
          locale,
        },
      },
    });

    if (localization) {
      return {
        subject: localization.subject,
        htmlBody: localization.htmlBody,
        textBody: localization.textBody || undefined,
      };
    }

    // Fall back to base template
    const template = await prisma.emailTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return null;
    }

    return {
      subject: template.subject,
      htmlBody: template.htmlBody,
      textBody: template.textBody || undefined,
    };
  }

  /**
   * Add localization to a template
   */
  async addLocalization(
    templateId: string,
    locale: string,
    subject: string,
    htmlBody: string,
    textBody?: string
  ): Promise<LocalizedTemplate> {
    const template = await prisma.emailTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    const localization = await prisma.emailTemplateLocalization.create({
      data: {
        templateId,
        locale,
        subject,
        htmlBody,
        textBody,
      },
    });

    return {
      templateId: localization.templateId,
      locale: localization.locale,
      subject: localization.subject,
      htmlBody: localization.htmlBody,
      textBody: localization.textBody || undefined,
    };
  }

  /**
   * Update localization
   */
  async updateLocalization(
    templateId: string,
    locale: string,
    updates: {
      subject?: string;
      htmlBody?: string;
      textBody?: string;
    }
  ): Promise<LocalizedTemplate> {
    const existing = await prisma.emailTemplateLocalization.findUnique({
      where: {
        templateId_locale: {
          templateId,
          locale,
        },
      },
    });

    if (!existing) {
      throw new Error('Localization not found');
    }

    const updated = await prisma.emailTemplateLocalization.update({
      where: {
        templateId_locale: {
          templateId,
          locale,
        },
      },
      data: updates,
    });

    return {
      templateId: updated.templateId,
      locale: updated.locale,
      subject: updated.subject,
      htmlBody: updated.htmlBody,
      textBody: updated.textBody || undefined,
    };
  }

  /**
   * Delete localization
   */
  async deleteLocalization(templateId: string, locale: string): Promise<void> {
    await prisma.emailTemplateLocalization.delete({
      where: {
        templateId_locale: {
          templateId,
          locale,
        },
      },
    });
  }

  /**
   * Get all available locales for a template
   */
  async getAvailableLocales(templateId: string): Promise<string[]> {
    const template = await prisma.emailTemplate.findUnique({
      where: { id: templateId },
      select: { locale: true },
    });

    if (!template) {
      return [];
    }

    const localizations = await prisma.emailTemplateLocalization.findMany({
      where: { templateId },
      select: { locale: true },
    });

    const locales = new Set([template.locale]);
    localizations.forEach((l) => locales.add(l.locale));

    return Array.from(locales);
  }

  /**
   * Get all templates for a locale
   */
  async getTemplatesForLocale(locale: string, tenantId: string): Promise<any[]> {
    // First get templates with matching locale
    const directTemplates = await prisma.emailTemplate.findMany({
      where: {
        tenantId,
        locale,
        isActive: true,
      },
    });

    // Then get templates with localizations
    const localizedTemplates = await prisma.emailTemplateLocalization.findMany({
      where: { locale },
      include: {
        template: true,
      },
    });

    const results: any[] = [];

    // Add direct templates
    for (const template of directTemplates) {
      results.push({
        id: template.id,
        name: template.name,
        category: template.category,
        subject: template.subject,
        htmlBody: template.htmlBody,
        textBody: template.textBody,
        variables: template.variables,
        locale: template.locale,
        isLocalized: false,
      });
    }

    // Add localized templates
    for (const loc of localizedTemplates) {
      if (loc.template.tenantId === tenantId && loc.template.isActive) {
        results.push({
          id: loc.template.id,
          name: loc.template.name,
          category: loc.template.category,
          subject: loc.subject,
          htmlBody: loc.htmlBody,
          textBody: loc.textBody,
          variables: loc.template.variables,
          locale: loc.locale,
          isLocalized: true,
          baseLocale: loc.template.locale,
        });
      }
    }

    return results;
  }

  /**
   * Copy template to new locale
   */
  async copyToLocale(
    templateId: string,
    targetLocale: string,
    translateSubject?: string,
    translateHtmlBody?: string,
    translateTextBody?: string
  ): Promise<LocalizedTemplate> {
    const template = await prisma.emailTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    return await this.addLocalization(
      templateId,
      targetLocale,
      translateSubject || template.subject,
      translateHtmlBody || template.htmlBody,
      translateTextBody || template.textBody || undefined
    );
  }

  /**
   * Get supported locales
   */
  getSupportedLocales(): Array<{ code: string; name: string }> {
    return [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
      { code: 'it', name: 'Italian' },
      { code: 'pt', name: 'Portuguese' },
      { code: 'zh', name: 'Chinese' },
      { code: 'ja', name: 'Japanese' },
      { code: 'ko', name: 'Korean' },
      { code: 'ar', name: 'Arabic' },
      { code: 'ru', name: 'Russian' },
      { code: 'hi', name: 'Hindi' },
    ];
  }
}

export default EmailLocalizationService;
