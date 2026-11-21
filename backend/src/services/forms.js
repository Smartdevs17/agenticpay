"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formSubmissionSchema = exports.formDefinitionSchema = exports.formFieldSchema = exports.formFieldVisibilitySchema = exports.formOptionSchema = exports.formFieldTypeSchema = void 0;
exports.createForm = createForm;
exports.listForms = listForms;
exports.getForm = getForm;
exports.submitForm = submitForm;
var node_crypto_1 = require("node:crypto");
var zod_1 = require("zod");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
exports.formFieldTypeSchema = zod_1.z.enum(['text', 'number', 'date', 'file', 'select']);
exports.formOptionSchema = zod_1.z.object({
    label: zod_1.z.string().min(1, 'Option label is required'),
    value: zod_1.z.string().min(1, 'Option value is required'),
});
exports.formFieldVisibilitySchema = zod_1.z.object({
    fieldName: zod_1.z.string().min(1, 'Dependency field is required'),
    value: zod_1.z.string().min(1, 'Dependency value is required'),
});
exports.formFieldSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1, 'Field name is required'),
    label: zod_1.z.string().min(1, 'Field label is required'),
    type: exports.formFieldTypeSchema,
    required: zod_1.z.boolean().default(false),
    placeholder: zod_1.z.string().optional(),
    helpText: zod_1.z.string().optional(),
    accept: zod_1.z.string().optional(),
    pattern: zod_1.z.string().optional(),
    min: zod_1.z.number().optional(),
    max: zod_1.z.number().optional(),
    maxSizeBytes: zod_1.z.number().positive().optional(),
    options: zod_1.z.array(exports.formOptionSchema).optional(),
    visibleIf: exports.formFieldVisibilitySchema.optional(),
});
exports.formDefinitionSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Form name is required'),
    description: zod_1.z.string().optional(),
    fields: zod_1.z.array(exports.formFieldSchema).min(1, 'At least one field is required'),
});
exports.formSubmissionSchema = zod_1.z.object({
    values: zod_1.z.record(zod_1.z.any()),
});
var formAnalyticsDefaults = {
    views: 0,
    submissions: 0,
    completions: 0,
    completionRate: 0,
};
var forms = new Map();
var submissions = new Map();
function sanitizeFileField(value) {
    if (!value || typeof value !== 'object')
        return null;
    var candidate = value;
    if (typeof candidate.filename !== 'string' ||
        typeof candidate.mimeType !== 'string' ||
        typeof candidate.content !== 'string' ||
        typeof candidate.size !== 'number') {
        return null;
    }
    return {
        filename: candidate.filename,
        mimeType: candidate.mimeType,
        size: candidate.size,
        content: candidate.content,
    };
}
function createForm(input) {
    var parsed = exports.formDefinitionSchema.parse(input);
    var id = (0, node_crypto_1.randomUUID)();
    var now = new Date().toISOString();
    var form = {
        id: id,
        name: parsed.name,
        description: parsed.description,
        fields: parsed.fields,
        createdAt: now,
        updatedAt: now,
        analytics: __assign({}, formAnalyticsDefaults),
    };
    forms.set(id, form);
    submissions.set(id, []);
    return form;
}
function listForms() {
    return Array.from(forms.values()).map(function (form) { return (__assign(__assign({}, form), { analytics: __assign(__assign({}, form.analytics), { completionRate: form.analytics.views > 0 ? Math.round((form.analytics.completions / form.analytics.views) * 100) : 0 }) })); });
}
function getForm(id, trackView) {
    var _a;
    if (trackView === void 0) { trackView = false; }
    var form = (_a = forms.get(id)) !== null && _a !== void 0 ? _a : null;
    if (!form)
        return null;
    if (trackView) {
        form.analytics.views += 1;
        form.analytics.completionRate = form.analytics.views > 0 ? Math.round((form.analytics.completions / form.analytics.views) * 100) : 0;
    }
    return __assign(__assign({}, form), { analytics: __assign(__assign({}, form.analytics), { completionRate: form.analytics.views > 0 ? Math.round((form.analytics.completions / form.analytics.views) * 100) : 0 }) });
}
function isFieldVisible(field, values) {
    if (!field.visibleIf)
        return true;
    var targetValue = values[field.visibleIf.fieldName];
    return String(targetValue) === field.visibleIf.value;
}
function validateFieldValue(field, value) {
    var _a;
    if (field.type === 'file') {
        var fileValue = sanitizeFileField(value);
        if (!fileValue) {
            return field.required ? 'File upload is required' : null;
        }
        if (field.maxSizeBytes && fileValue.size > field.maxSizeBytes) {
            return "File exceeds maximum size of ".concat(field.maxSizeBytes, " bytes");
        }
        if (field.accept && fileValue.mimeType) {
            var acceptPattern = field.accept
                .split(',')
                .map(function (item) { return item.trim(); })
                .filter(Boolean)
                .map(function (item) { return item.replace('*', '.*'); })
                .join('|');
            var regex = new RegExp("^(".concat(acceptPattern, ")$"), 'i');
            if (!regex.test(fileValue.mimeType) && !regex.test(fileValue.filename)) {
                return "File type must match ".concat(field.accept);
            }
        }
        return null;
    }
    var valueAsString = value === undefined || value === null ? '' : String(value);
    if (field.required && valueAsString.trim() === '') {
        return 'This field is required';
    }
    if (field.pattern && valueAsString.trim() !== '') {
        var regex = void 0;
        try {
            regex = new RegExp(field.pattern);
        }
        catch (_b) {
            return 'Invalid field pattern in form configuration';
        }
        if (!regex.test(valueAsString)) {
            return 'Value does not match required pattern';
        }
    }
    if (field.type === 'number' && valueAsString !== '') {
        var numeric = Number(valueAsString);
        if (!Number.isFinite(numeric)) {
            return 'A valid number is required';
        }
        if (field.min !== undefined && numeric < field.min) {
            return "Value must be at least ".concat(field.min);
        }
        if (field.max !== undefined && numeric > field.max) {
            return "Value must be at most ".concat(field.max);
        }
    }
    if (field.type === 'select' && valueAsString !== '' && ((_a = field.options) === null || _a === void 0 ? void 0 : _a.length)) {
        var valid = field.options.some(function (option) { return option.value === valueAsString; });
        if (!valid) {
            return 'Selected value is not valid';
        }
    }
    return null;
}
function submitForm(formId, payload) {
    var _a;
    var form = forms.get(formId);
    if (!form) {
        throw new errorHandler_js_1.AppError(404, 'Form not found', 'NOT_FOUND');
    }
    var parsed = exports.formSubmissionSchema.parse(payload);
    var values = parsed.values || {};
    var errors = [];
    form.fields.forEach(function (field) {
        if (!isFieldVisible(field, values))
            return;
        var errorMessage = validateFieldValue(field, values[field.name]);
        if (errorMessage) {
            errors.push({ field: field.name, message: errorMessage });
        }
    });
    if (errors.length > 0) {
        throw new errorHandler_js_1.AppError(400, 'Form submission failed due to validation errors', 'VALIDATION_ERROR', { errors: errors });
    }
    var success = true;
    var submission = {
        id: (0, node_crypto_1.randomUUID)(),
        formId: formId,
        submittedAt: new Date().toISOString(),
        values: values,
        success: success,
    };
    var formSubmissions = (_a = submissions.get(formId)) !== null && _a !== void 0 ? _a : [];
    formSubmissions.push(submission);
    submissions.set(formId, formSubmissions);
    form.analytics.submissions += 1;
    if (success) {
        form.analytics.completions += 1;
    }
    form.analytics.completionRate = form.analytics.views > 0 ? Math.round((form.analytics.completions / form.analytics.views) * 100) : 0;
    return submission;
}
// Seed a sample form so the feature is visible immediately.
(function seedSampleForm() {
    var sampleId = (0, node_crypto_1.randomUUID)();
    var sampleForm = {
        id: sampleId,
        name: 'Client Intake Form',
        description: 'Capture client details, delivery dates, and optional file attachments.',
        fields: [
            {
                id: (0, node_crypto_1.randomUUID)(),
                name: 'clientName',
                label: 'Client Name',
                type: 'text',
                required: true,
                placeholder: 'Enter your full name',
            },
            {
                id: (0, node_crypto_1.randomUUID)(),
                name: 'projectBudget',
                label: 'Project Budget',
                type: 'number',
                required: true,
                placeholder: 'Enter budget',
                min: 100,
                max: 100000,
            },
            {
                id: (0, node_crypto_1.randomUUID)(),
                name: 'preferredContact',
                label: 'Preferred Contact Method',
                type: 'select',
                required: true,
                options: [
                    { label: 'Email', value: 'email' },
                    { label: 'Phone', value: 'phone' },
                ],
            },
            {
                id: (0, node_crypto_1.randomUUID)(),
                name: 'contactEmail',
                label: 'Contact Email',
                type: 'text',
                required: true,
                pattern: '^\\S+@\\S+\\.\\S+$',
                placeholder: 'you@example.com',
                visibleIf: { fieldName: 'preferredContact', value: 'email' },
            },
            {
                id: (0, node_crypto_1.randomUUID)(),
                name: 'contactPhone',
                label: 'Contact Phone',
                type: 'text',
                required: true,
                placeholder: '+1 555 123 4567',
                visibleIf: { fieldName: 'preferredContact', value: 'phone' },
            },
            {
                id: (0, node_crypto_1.randomUUID)(),
                name: 'proposalPackage',
                label: 'Upload Proposal',
                type: 'file',
                accept: '.pdf,.doc,.docx',
                maxSizeBytes: 5000000,
                helpText: 'Accepted formats: PDF or Word document. Max 5MB.',
            },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        analytics: __assign({}, formAnalyticsDefaults),
    };
    forms.set(sampleId, sampleForm);
    submissions.set(sampleId, []);
})();
