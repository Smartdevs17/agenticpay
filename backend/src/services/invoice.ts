import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'The OPENAI_API_KEY environment variable is missing or empty; provide it to generate invoices.'
    );
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

interface InvoiceRequest {
  projectId: string;
  workDescription: string;
  hoursWorked: number;
  hourlyRate: number;
}

interface Invoice {
  id: string;
  projectId: string;
  lineItems: Array<{
    description: string;
    hours: number;
    rate: number;
    amount: number;
  }>;
  subtotal: number;
  total: number;
  currency: string;
  generatedAt: string;
  summary: string;
}

export async function generateInvoice(request: InvoiceRequest): Promise<Invoice> {
  const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are an invoice generator. Given a work description, hours, and rate, generate professional line items. Respond with JSON containing: lineItems (array of {description, hours, rate, amount}), summary (brief invoice summary).',
      },
      {
        role: 'user',
        content: `Work: ${request.workDescription}\nHours: ${request.hoursWorked}\nRate: $${request.hourlyRate}/hr`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const generated = JSON.parse(completion.choices[0].message.content || '{}');
  const lineItems = generated.lineItems || [
    {
      description: request.workDescription,
      hours: request.hoursWorked,
      rate: request.hourlyRate,
      amount: request.hoursWorked * request.hourlyRate,
    },
  ];

  const subtotal = lineItems.reduce(
    (sum: number, item: { amount: number }) => sum + item.amount,
    0
  );

  return {
    id,
    projectId: request.projectId,
    lineItems,
    subtotal,
    total: subtotal,
    currency: 'XLM',
    generatedAt: new Date().toISOString(),
    summary: generated.summary || 'Invoice generated for completed work',
  };
}
