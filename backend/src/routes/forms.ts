import { Router } from 'express';
import { 
  createForm, 
  getForm, 
  listForms, 
  submitForm,
  updateForm,
  deleteForm,
  getFormSubmissions,
  saveDraft,
  getDrafts,
  deleteDraft,
} from '../services/forms.js';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { formDefinitionSchema, formSubmissionSchema, formDraftSchema } from '../services/forms.js';

export const formsRouter = Router();

// List available forms with analytics
formsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const forms = listForms();
    res.json({ forms, total: forms.length });
  }),
);

// Create a new custom form schema
formsRouter.post(
  '/',
  validate(formDefinitionSchema),
  asyncHandler(async (req, res) => {
    const form = createForm(req.body);
    res.status(201).json(form);
  }),
);

// Get a form schema by id and track view analytics
formsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const form = getForm(id, true);

    if (!form) {
      throw new AppError(404, 'Form not found', 'NOT_FOUND');
    }

    res.json(form);
  }),
);

// Update a form schema
formsRouter.put(
  '/:id',
  validate(formDefinitionSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const form = updateForm(id, req.body);
    res.json(form);
  }),
);

// Delete a form schema
formsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    deleteForm(id);
    res.status(204).send();
  }),
);

// Get form submissions
formsRouter.get(
  '/:id/submissions',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const submissions = getFormSubmissions(id);
    res.json({ submissions, total: submissions.length });
  }),
);

// Submit form responses
formsRouter.post(
  '/:id/submissions',
  validate(formSubmissionSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const submission = submitForm(id, req.body);
    res.status(201).json(submission);
  }),
);

// Save form draft
formsRouter.post(
  '/:id/drafts',
  validate(formDraftSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const draft = saveDraft(id, req.body.values);
    res.status(201).json(draft);
  }),
);

// Get form drafts
formsRouter.get(
  '/:id/drafts',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const drafts = getDrafts(id);
    res.json({ drafts, total: drafts.length });
  }),
);

// Delete specific draft
formsRouter.delete(
  '/:id/drafts/:draftId',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const draftId = Array.isArray(req.params.draftId) ? req.params.draftId[0] : req.params.draftId;
    deleteDraft(id, draftId);
    res.status(204).send();
  }),
);
