# Form Builder & Schema Validation System

## Overview

The custom form builder system enables creation of dynamic forms with JSON schema validation, conditional field visibility, file upload handling, and comprehensive analytics tracking.

## Features

### ✅ Completed Features

1. **Form Schema JSON with Field Types**
   - Text, Number, Date, File, and Select field types
   - Flexible field configuration with validation rules

2. **Validators**
   - Required field validation
   - Pattern matching (regex)
   - Min/Max value constraints
   - File type and size validation

3. **Conditional Field Visibility**
   - Show/hide fields based on other field values
   - Field dependencies support
   - Complex visibility logic

4. **File Upload Handling**
   - Base64 file encoding
   - MIME type validation
   - File size limits
   - Multiple file type support

5. **Form Analytics**
   - View tracking
   - Submission counts
   - Completion rates
   - Real-time analytics dashboard

6. **Auto-Save Drafts**
   - Browser localStorage integration
   - Automatic draft saving
   - Draft recovery on page reload

7. **Embeddable Forms**
   - Standalone embed pages via iframe
   - CORS-friendly embedding
   - Auto-saved form state

## Architecture

### Backend (`backend/src/`)

**Services (`services/forms.ts`):**
- Form CRUD operations
- Schema validation with Zod
- Submission processing
- Draft management
- Analytics calculation

**Routes (`routes/forms.ts`):**
- `GET /api/v1/forms` - List all forms
- `POST /api/v1/forms` - Create new form
- `GET /api/v1/forms/:id` - Get form by ID (tracks views)
- `PUT /api/v1/forms/:id` - Update form
- `DELETE /api/v1/forms/:id` - Delete form
- `POST /api/v1/forms/:id/submissions` - Submit form
- `GET /api/v1/forms/:id/submissions` - Get submissions
- `POST /api/v1/forms/:id/drafts` - Save draft
- `GET /api/v1/forms/:id/drafts` - Get drafts
- `DELETE /api/v1/forms/:id/drafts/:draftId` - Delete draft

### Frontend (`frontend/`)

**Components:**
- `FormBuilder.tsx` - Schema builder with drag-drop field ordering
- `FormRenderer.tsx` - Dynamic form rendering with validation
- `FormEmbed.tsx` - Embeddable form component
- `FormAnalytics.tsx` - Analytics dashboard with charts
- `FormIframeWrapper.tsx` - Iframe embedding instructions

**Pages:**
- `dashboard/forms/` - Form management hub
- `dashboard/forms/[id]/analytics` - Form analytics view
- `forms/embed/[id]` - Embeddable form page

**API Methods (`lib/api.ts`):**
```typescript
api.forms.listForms()
api.forms.getForm(id)
api.forms.createForm(payload)
api.forms.updateForm(id, payload)
api.forms.deleteForm(id)
api.forms.submitForm(id, values)
api.forms.getSubmissions(id)
api.forms.saveDraft(id, values)
api.forms.getDrafts(id)
api.forms.deleteDraft(id, draftId)
```

## Usage

### Creating a Form

1. Navigate to `/dashboard/forms`
2. Click "Add field" to create form fields
3. Configure field type, validation, and conditional visibility
4. Click "Save schema"
5. Use the embed code or embed URL to integrate the form

### Form Configuration

**Field Types:**
- **Text**: Single-line text input
- **Number**: Numeric input with min/max constraints
- **Date**: Date picker
- **File**: File upload with type/size validation
- **Select**: Dropdown with predefined options

**Validation:**
- `required`: Field is mandatory
- `pattern`: Regex pattern for text validation
- `min/max`: Min/max values for numbers
- `accept`: File type filter (e.g., `.pdf,.doc`)
- `maxSizeBytes`: Maximum file size in bytes

**Conditional Visibility:**
- Set `visibleIf` to show field when another field has specific value
- Example: Show "Email" field when "Contact Method" = "email"

### Embedding Forms

**Via Iframe URL:**
```html
<iframe
  src="https://your-domain.com/forms/embed/{formId}"
  width="100%"
  height="600"
  frameborder="0"
  style="border: 1px solid #e5e7eb; border-radius: 0.5rem;"
></iframe>
```

**Copy Code Feature:**
- Use the "Embed" button in the forms list to copy the embed URL
- Paste into third-party websites

### Viewing Analytics

1. Go to `/dashboard/forms`
2. Click "Analytics" button on the form
3. View:
   - View count
   - Submission count
   - Completion count
   - Completion rate percentage
   - Charts showing form activity
   - Submission details
   - Export submissions as CSV

## Data Models

### FormDefinition
```typescript
{
  id: string;
  name: string;
  description?: string;
  fields: FormFieldSchema[];
  createdAt: string;
  updatedAt: string;
  analytics: FormAnalytics;
}
```

### FormFieldSchema
```typescript
{
  id: string;
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'file' | 'select';
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  pattern?: string;
  min?: number;
  max?: number;
  maxSizeBytes?: number;
  accept?: string;
  options?: FormFieldOption[];
  visibleIf?: { fieldName: string; value: string };
}
```

### FormSubmission
```typescript
{
  id: string;
  formId: string;
  submittedAt: string;
  values: Record<string, unknown>;
  success: boolean;
}
```

### FormDraft
```typescript
{
  id: string;
  formId: string;
  values: Record<string, unknown>;
  savedAt: string;
}
```

## Edge Cases Handled

1. **Large Forms**: Virtualized scrolling support with drag-drop reordering
2. **File Upload Size**: Validation with configurable max size limits
3. **Validation Bypass**: Server-side validation ensures data integrity
4. **Conditional Logic**: Proper field visibility tracking during form fill
5. **Draft Recovery**: Automatic restoration from localStorage
6. **Network Errors**: Graceful error handling and retry logic
7. **CORS**: Embeddable forms work cross-domain

## Sample Form Schema

```json
{
  "name": "Client Intake Form",
  "description": "Capture client details and proposal",
  "fields": [
    {
      "id": "field-1",
      "name": "clientName",
      "label": "Client Name",
      "type": "text",
      "required": true,
      "placeholder": "Enter your full name"
    },
    {
      "id": "field-2",
      "name": "projectBudget",
      "label": "Project Budget",
      "type": "number",
      "required": true,
      "min": 100,
      "max": 100000
    },
    {
      "id": "field-3",
      "name": "preferredContact",
      "label": "Preferred Contact",
      "type": "select",
      "required": true,
      "options": [
        { "label": "Email", "value": "email" },
        { "label": "Phone", "value": "phone" }
      ]
    },
    {
      "id": "field-4",
      "name": "contactEmail",
      "label": "Email",
      "type": "text",
      "pattern": "^\\S+@\\S+\\.\\S+$",
      "visibleIf": { "fieldName": "preferredContact", "value": "email" }
    },
    {
      "id": "field-5",
      "name": "proposal",
      "label": "Proposal Document",
      "type": "file",
      "accept": ".pdf,.doc,.docx",
      "maxSizeBytes": 5000000
    }
  ]
}
```

## Testing

### Backend Validation Tests
- Required field validation
- Pattern matching validation
- Range validation (min/max)
- File type and size validation
- Conditional visibility logic

### Frontend Integration Tests
- Form rendering with all field types
- Draft auto-save functionality
- Submission handling
- Error display
- Analytics tracking

## Security Considerations

1. **Input Validation**: Both frontend and backend validation
2. **File Upload**: Type and size restrictions
3. **CORS Support**: Safe cross-domain embedding
4. **Data Persistence**: Secure storage in user's browser cache
5. **Analytics Privacy**: Form submissions captured securely

## Performance Optimizations

1. **Lazy Loading**: Forms load on demand
2. **Draft Caching**: LocalStorage for instant draft recovery
3. **Pagination**: Submission tables paginated
4. **Memoization**: React memo for form field components
5. **Debouncing**: Draft saving debounced

## Future Enhancements

- [ ] Form versioning and rollback
- [ ] Template library for common forms
- [ ] Advanced conditional logic (AND/OR operators)
- [ ] Webhook integration for submissions
- [ ] Email notifications on submit
- [ ] Multi-step forms/wizards
- [ ] Custom CSS styling per form
- [ ] Integration with CRM systems
- [ ] Form abandonment tracking
- [ ] A/B testing capabilities
