import { z } from 'zod';
import { UuidSchema, IsoDateTimeOutSchema, EmailSchema } from './common.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from './pagination.js';
import {
  DateOnlySchema,
  PaiseSchema,
  NonNegativePaiseSchema,
  PositivePaiseSchema,
  PaymentMethodSchema,
  PaymentReceiptSchema,
  PersonRefSchema,
  RevenueSourceEnum,
} from './domain-common.js';

// ---- Invoices (API_CONTRACT 1 and 10.1) ----

export const InvoiceStatusEnum = z.enum(['DRAFT', 'SENT', 'PAID', 'VOID']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusEnum>;

export const InvoiceBillToSchema = z.object({
  type: z.enum(['MEMBER', 'BUSINESS_CLIENT']),
  id: UuidSchema,
  name: z.string(),
});
export type InvoiceBillTo = z.infer<typeof InvoiceBillToSchema>;

export const InvoiceLineSchema = z.object({
  description: z.string(),
  qty: z.number().int().positive(),
  unitPricePaise: PaiseSchema,
  lineTotalPaise: PaiseSchema,
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const InvoiceSchema = z.object({
  id: UuidSchema,
  invoiceNumber: z.string(),
  status: InvoiceStatusEnum,
  billTo: InvoiceBillToSchema,
  issueDate: DateOnlySchema,
  dueDate: DateOnlySchema,
  lines: z.array(InvoiceLineSchema),
  subtotalPaise: PaiseSchema,
  taxPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  paidPaise: PaiseSchema,
  balancePaise: PaiseSchema,
  notes: z.string().nullable(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const InvoicePaymentSchema = z.object({
  id: UuidSchema,
  amountPaise: PaiseSchema,
  method: PaymentMethodSchema,
  paidAt: IsoDateTimeOutSchema,
});
export type InvoicePayment = z.infer<typeof InvoicePaymentSchema>;

/** GET /invoices/:id */
export const InvoiceDetailSchema = InvoiceSchema.extend({
  payments: z.array(InvoicePaymentSchema),
});
export type InvoiceDetail = z.infer<typeof InvoiceDetailSchema>;

export const InvoicePageSchema = createPaginatedResponseSchema(InvoiceSchema);

/** GET /invoices */
export const InvoiceListQuerySchema = PaginationQuerySchema.extend({
  status: InvoiceStatusEnum.optional(),
  memberId: UuidSchema.optional(),
  businessClientId: UuidSchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  overdue: z.enum(['true', 'false']).optional(),
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

export const CreateInvoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  qty: z.number().int().positive(),
  unitPricePaise: NonNegativePaiseSchema,
});

/** POST /invoices: exactly one of memberId / businessClientId. */
export const CreateInvoiceRequestSchema = z
  .object({
    memberId: UuidSchema.optional(),
    businessClientId: UuidSchema.optional(),
    issueDate: DateOnlySchema.optional(),
    dueDate: DateOnlySchema.optional(),
    lines: z.array(CreateInvoiceLineSchema).min(1).max(50),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => Boolean(v.memberId) !== Boolean(v.businessClientId), {
    message: 'Provide exactly one of memberId or businessClientId',
    path: ['memberId'],
  })
  .refine((v) => !v.issueDate || !v.dueDate || v.dueDate >= v.issueDate, {
    message: 'dueDate must not be before issueDate',
    path: ['dueDate'],
  });
export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequestSchema>;

/** POST /invoices/:id/pay */
export const PayInvoiceRequestSchema = z.object({
  method: PaymentMethodSchema,
  amountPaise: PositivePaiseSchema.optional(),
  reference: z.string().trim().max(100).optional(),
});
export type PayInvoiceRequest = z.infer<typeof PayInvoiceRequestSchema>;

export const PayInvoiceResponseSchema = z.object({
  invoice: InvoiceSchema,
  payment: PaymentReceiptSchema,
});
export type PayInvoiceResponse = z.infer<typeof PayInvoiceResponseSchema>;

/** POST /invoices/:id/void */
export const VoidInvoiceRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidInvoiceRequest = z.infer<typeof VoidInvoiceRequestSchema>;

// ---- Business clients ----

export const BusinessClientSchema = z.object({
  id: UuidSchema,
  companyName: z.string(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  gstin: z.string().nullable(),
  billingAddress: z.string().nullable(),
  openBalancePaise: PaiseSchema,
});
export type BusinessClient = z.infer<typeof BusinessClientSchema>;

export const BusinessClientPageSchema = createPaginatedResponseSchema(BusinessClientSchema);

export const BusinessClientListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().optional(),
});
export type BusinessClientListQuery = z.infer<typeof BusinessClientListQuerySchema>;

export const CreateBusinessClientRequestSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).optional(),
  email: EmailSchema.optional(),
  phone: z.string().trim().max(32).optional(),
  gstin: z.string().trim().max(32).optional(),
  billingAddress: z.string().trim().max(500).optional(),
});
export type CreateBusinessClientRequest = z.infer<typeof CreateBusinessClientRequestSchema>;

export const UpdateBusinessClientRequestSchema = CreateBusinessClientRequestSchema.partial();
export type UpdateBusinessClientRequest = z.infer<typeof UpdateBusinessClientRequestSchema>;

// ---- Payments ledger and tax (10.2) ----

export const LedgerPaymentSchema = z.object({
  id: UuidSchema,
  source: z.string(),
  sourceId: UuidSchema.nullable(),
  kind: z.string(),
  amountPaise: PaiseSchema,
  method: PaymentMethodSchema,
  receivedBy: PersonRefSchema.nullable(),
  shiftId: UuidSchema.nullable(),
  paidAt: IsoDateTimeOutSchema,
  reference: z.string().nullable(),
});
export type LedgerPayment = z.infer<typeof LedgerPaymentSchema>;

export const LedgerPaymentPageSchema = createPaginatedResponseSchema(LedgerPaymentSchema);

export const PaymentListQuerySchema = PaginationQuerySchema.extend({
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  source: z.string().optional(),
  method: PaymentMethodSchema.optional(),
  kind: z.string().optional(),
});
export type PaymentListQuery = z.infer<typeof PaymentListQuerySchema>;

export const TaxSummaryQuerySchema = z
  .object({
    from: DateOnlySchema,
    to: DateOnlySchema,
  })
  .refine((v) => v.to >= v.from, { message: 'to must not be before from', path: ['to'] });
export type TaxSummaryQuery = z.infer<typeof TaxSummaryQuerySchema>;

export const TaxSummaryRowSchema = z.object({
  source: RevenueSourceEnum.or(z.string()),
  grossPaise: PaiseSchema,
  taxRateBp: z.number().int().min(0),
  taxPaise: PaiseSchema,
  netPaise: PaiseSchema,
});
export type TaxSummaryRow = z.infer<typeof TaxSummaryRowSchema>;

export const TaxSummarySchema = z.object({
  from: DateOnlySchema,
  to: DateOnlySchema,
  rows: z.array(TaxSummaryRowSchema),
  totals: z.object({
    grossPaise: PaiseSchema,
    taxPaise: PaiseSchema,
    netPaise: PaiseSchema,
  }),
  note: z.string(),
});
export type TaxSummary = z.infer<typeof TaxSummarySchema>;
