export interface NotificationTemplate {
    id: string;
    name: string;
    category: 'transactional' | 'marketing' | 'announcement' | 'alert' | 'verification';
    channels: ('email' | 'sms' | 'push' | 'in-app')[];
    subject: string;
    title?: string;
    body: string;
    smsBody?: string;
    pushBody?: string;
    variables: string[];
    createdAt: Date;
    updatedAt: Date;
}

const templates: Map<string, NotificationTemplate> = new Map();

// Seed default templates
function seedTemplates(): void {
    const now = new Date();

    const defaultTemplates: NotificationTemplate[] = [
        {
            id: 'welcome-email',
            name: 'Welcome Email',
            category: 'transactional',
            channels: ['email', 'in-app'],
            subject: 'Welcome to AgenticPay, {{name}}!',
            title: 'Welcome Aboard!',
            body: 'Hi {{name}},\n\nWelcome to AgenticPay! We\'re excited to have you on board.\n\nGet started by {{action}}.\n\nBest,\nThe AgenticPay Team',
            smsBody: 'Welcome to AgenticPay, {{name}}! Get started today.',
            pushBody: 'Welcome to AgenticPay, {{name}}!',
            variables: ['name', 'action'],
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'payment-received',
            name: 'Payment Received',
            category: 'transactional',
            channels: ['email', 'push', 'in-app', 'sms'],
            subject: 'Payment of {{amount}} {{currency}} Received',
            title: 'Payment Received',
            body: 'Hi {{name}},\n\nYou\'ve received a payment of {{amount}} {{currency}} from {{sender}}.\n\nTransaction ID: {{transactionId}}\nDate: {{date}}\n\nView details in your dashboard.',
            smsBody: 'Payment of {{amount}} {{currency}} received from {{sender}}. TX: {{transactionId}}',
            pushBody: '{{amount}} {{currency}} received from {{sender}}',
            variables: ['name', 'amount', 'currency', 'sender', 'transactionId', 'date'],
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'payment-sent',
            name: 'Payment Sent',
            category: 'transactional',
            channels: ['email', 'push', 'in-app'],
            subject: 'Payment of {{amount}} {{currency}} Sent',
            title: 'Payment Sent',
            body: 'Hi {{name}},\n\nYou\'ve sent a payment of {{amount}} {{currency}} to {{recipient}}.\n\nTransaction ID: {{transactionId}}\nDate: {{date}}',
            pushBody: '{{amount}} {{currency}} sent to {{recipient}}',
            variables: ['name', 'amount', 'currency', 'recipient', 'transactionId', 'date'],
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'account-verified',
            name: 'Account Verified',
            category: 'verification',
            channels: ['email', 'in-app'],
            subject: 'Your Account Has Been Verified',
            title: 'Account Verified',
            body: 'Hi {{name}},\n\nYour account has been successfully verified. You now have full access to all features.\n\nThank you for your patience during the verification process.',
            variables: ['name'],
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'security-alert',
            name: 'Security Alert',
            category: 'alert',
            channels: ['email', 'sms', 'push', 'in-app'],
            subject: 'Security Alert: {{action}} on Your Account',
            title: 'Security Alert',
            body: 'Hi {{name}},\n\nWe detected {{action}} on your account.\n\nTime: {{time}}\nDevice: {{device}}\nLocation: {{location}}\n\nIf this was you, no action needed. If not, please secure your account immediately.',
            smsBody: 'Security alert: {{action}} on your account at {{time}}. If not you, secure your account.',
            pushBody: 'Security alert: {{action}} detected',
            variables: ['name', 'action', 'time', 'device', 'location'],
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'announcement',
            name: 'Product Announcement',
            category: 'announcement',
            channels: ['email', 'in-app', 'push'],
            subject: '{{title}} - New Features Available',
            title: '{{title}}',
            body: 'Hi {{name}},\n\nWe\'re excited to announce {{title}}!\n\n{{description}}\n\n{{cta}}\n\nCheck it out in your dashboard.',
            pushBody: '{{title}} - {{description}}',
            variables: ['name', 'title', 'description', 'cta'],
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'quota-warning',
            name: 'Quota Warning',
            category: 'alert',
            channels: ['email', 'push', 'in-app'],
            subject: 'API Quota Warning: {{usage}}% Used',
            title: 'Quota Warning',
            body: 'Hi {{name}},\n\nYou\'ve used {{usage}}% of your {{plan}} plan API quota.\n\n{{remaining}} requests remaining (resets {{resetDate}}).\n\nConsider upgrading your plan to avoid service interruption.',
            pushBody: 'API quota at {{usage}}% - {{remaining}} requests remaining',
            variables: ['name', 'usage', 'plan', 'remaining', 'resetDate'],
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'quota-exceeded',
            name: 'Quota Exceeded',
            category: 'alert',
            channels: ['email', 'push', 'in-app'],
            subject: 'API Quota Exceeded',
            title: 'Quota Exceeded',
            body: 'Hi {{name}},\n\nYou\'ve exceeded your {{plan}} plan API quota.\n\nRequests will be limited until {{resetDate}}.\n\nUpgrade your plan to increase your limits.',
            pushBody: 'API quota exceeded. Upgrade to continue without limits.',
            variables: ['name', 'plan', 'resetDate'],
            createdAt: now,
            updatedAt: now,
        },
    ];

    for (const tpl of defaultTemplates) {
        templates.set(tpl.id, tpl);
    }
}

seedTemplates();

export class NotificationTemplateManager {
    getTemplate(id: string): NotificationTemplate | undefined {
        return templates.get(id);
    }

    getAllTemplates(): NotificationTemplate[] {
        return Array.from(templates.values());
    }

    getTemplatesByCategory(category: NotificationTemplate['category']): NotificationTemplate[] {
        return Array.from(templates.values()).filter(t => t.category === category);
    }

    addTemplate(template: NotificationTemplate): void {
        template.createdAt = new Date();
        template.updatedAt = new Date();
        templates.set(template.id, template);
    }

    updateTemplate(id: string, updates: Partial<NotificationTemplate>): NotificationTemplate | undefined {
        const existing = templates.get(id);
        if (!existing) return undefined;
        Object.assign(existing, updates, { updatedAt: new Date() });
        templates.set(id, existing);
        return existing;
    }

    deleteTemplate(id: string): boolean {
        return templates.delete(id);
    }

    renderTemplate(template: NotificationTemplate, variables: Record<string, string>): { subject: string; title?: string; body: string; smsBody?: string; pushBody?: string } {
        let subject = template.subject;
        let title = template.title;
        let body = template.body;
        let smsBody = template.smsBody;
        let pushBody = template.pushBody;

        for (const [key, value] of Object.entries(variables)) {
            const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            subject = subject.replace(placeholder, value);
            if (title) title = title.replace(placeholder, value);
            body = body.replace(placeholder, value);
            if (smsBody) smsBody = smsBody.replace(placeholder, value);
            if (pushBody) pushBody = pushBody.replace(placeholder, value);
        }

        return { subject, title, body, smsBody, pushBody };
    }
}

export const templateManager = new NotificationTemplateManager();