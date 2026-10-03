import { z } from 'zod';
import { UuidSchema, IsoDateTimeOutSchema, NullableIsoDateTimeOutSchema } from './common.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from './pagination.js';
import {
  DateOnlySchema,
  PaiseSchema,
  PositivePaiseSchema,
  PctSchema,
  MemberRefSchema,
  PaymentMethodSchema,
  PaymentReceiptSchema,
} from './domain-common.js';

// ---- Tables and menu ----

export const BarTableStatusEnum = z.enum(['FREE', 'OCCUPIED']);

export const BarTableSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  seats: z.number().int().positive(),
  status: BarTableStatusEnum,
  openTab: z
    .object({
      id: UuidSchema,
      tabNumber: z.number().int(),
      label: z.string(),
      totalPaise: PaiseSchema,
      openedAt: IsoDateTimeOutSchema,
    })
    .nullable(),
});
export type BarTable = z.infer<typeof BarTableSchema>;
export const BarTableListSchema = z.array(BarTableSchema);

export const MenuItemSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  category: z.string(),
  station: z.string(),
  pricePaise: PaiseSchema,
  discountable: z.boolean(),
  isAvailable: z.boolean(),
});
export type MenuItem = z.infer<typeof MenuItemSchema>;
export const MenuItemListSchema = z.array(MenuItemSchema);

/** GET /bar/menu */
export const MenuQuerySchema = z.object({
  category: z.string().trim().min(1).optional(),
});
export type MenuQuery = z.infer<typeof MenuQuerySchema>;

/** POST /bar/menu */
export const CreateMenuItemRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  station: z.string().trim().min(1).max(50),
  pricePaise: PositivePaiseSchema,
  discountable: z.boolean().optional(),
});
export type CreateMenuItemRequest = z.infer<typeof CreateMenuItemRequestSchema>;

/** PUT /bar/menu/:id: any subset, plus isAvailable. */
export const UpdateMenuItemRequestSchema = CreateMenuItemRequestSchema.partial().extend({
  isAvailable: z.boolean().optional(),
});
export type UpdateMenuItemRequest = z.infer<typeof UpdateMenuItemRequestSchema>;

// ---- Tabs ----

export const TabStatusEnum = z.enum(['OPEN', 'SETTLED', 'VOID']);
export type TabStatus = z.infer<typeof TabStatusEnum>;

export const TabItemStatusEnum = z.enum(['PENDING', 'SENT', 'VOID']);

export const TabItemSchema = z.object({
  id: UuidSchema,
  menuItemId: UuidSchema,
  name: z.string(),
  qty: z.number().int().positive(),
  unitPricePaise: PaiseSchema,
  discountPct: PctSchema,
  lineTotalPaise: PaiseSchema,
  status: TabItemStatusEnum,
  ticketId: UuidSchema.nullable(),
  note: z.string().nullable(),
});
export type TabItem = z.infer<typeof TabItemSchema>;

export const TabSchema = z.object({
  id: UuidSchema,
  tabNumber: z.number().int(),
  status: TabStatusEnum,
  table: z.object({ id: UuidSchema, name: z.string() }).nullable(),
  member: MemberRefSchema.extend({ barDiscountPct: PctSchema }).nullable(),
  guestName: z.string().nullable(),
  openedAt: IsoDateTimeOutSchema,
  items: z.array(TabItemSchema),
  subtotalPaise: PaiseSchema,
  discountPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  settledAt: NullableIsoDateTimeOutSchema,
});
export type Tab = z.infer<typeof TabSchema>;

/** GET /bar/tabs items: a Tab without items, plus `itemCount`. */
export const TabSummarySchema = TabSchema.omit({ items: true }).extend({
  itemCount: z.number().int().min(0),
});
export type TabSummary = z.infer<typeof TabSummarySchema>;
export const TabSummaryPageSchema = createPaginatedResponseSchema(TabSummarySchema);

/** POST /bar/tabs: one of memberId or guestName required. */
export const OpenTabRequestSchema = z
  .object({
    tableId: UuidSchema.optional(),
    memberId: UuidSchema.optional(),
    guestName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.memberId) || Boolean(v.guestName), {
    message: 'Provide memberId or guestName',
    path: ['memberId'],
  });
export type OpenTabRequest = z.infer<typeof OpenTabRequestSchema>;

/** GET /bar/tabs */
export const TabListQuerySchema = PaginationQuerySchema.extend({
  status: TabStatusEnum.default('OPEN'),
  date: DateOnlySchema.optional(),
});
export type TabListQuery = z.infer<typeof TabListQuerySchema>;

/** POST /bar/tabs/:id/items */
export const AddTabItemRequestSchema = z.object({
  menuItemId: UuidSchema,
  qty: z.number().int().min(1).max(20),
  note: z.string().trim().max(200).optional(),
});
export type AddTabItemRequest = z.infer<typeof AddTabItemRequestSchema>;

/** DELETE /bar/tabs/:id/items/:itemId params */
export const TabItemParamSchema = z.object({
  id: UuidSchema,
  itemId: UuidSchema,
});
export type TabItemParam = z.infer<typeof TabItemParamSchema>;

export const TicketStatusEnum = z.enum(['NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']);
export type TicketStatus = z.infer<typeof TicketStatusEnum>;

/** POST /bar/tabs/:id/send */
export const SendTabResponseSchema = z.object({
  tab: TabSchema,
  tickets: z.array(
    z.object({
      id: UuidSchema,
      station: z.string(),
      status: z.literal('NEW'),
      itemCount: z.number().int().min(0),
    }),
  ),
});
export type SendTabResponse = z.infer<typeof SendTabResponseSchema>;

/** POST /bar/tabs/:id/settle */
export const SettleTabRequestSchema = z.object({
  payments: z
    .array(
      z.object({
        method: PaymentMethodSchema,
        amountPaise: PositivePaiseSchema.optional(),
        reference: z.string().trim().max(100).optional(),
      }),
    )
    .min(1)
    .max(10),
});
export type SettleTabRequest = z.infer<typeof SettleTabRequestSchema>;

export const SettleTabResponseSchema = z.object({
  tab: TabSchema,
  payments: z.array(PaymentReceiptSchema),
  receipt: z.object({
    tabNumber: z.number().int(),
    totalPaise: PaiseSchema,
    discountPaise: PaiseSchema,
    paidAt: IsoDateTimeOutSchema,
  }),
});
export type SettleTabResponse = z.infer<typeof SettleTabResponseSchema>;

/** POST /bar/tabs/:id/void */
export const VoidTabRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidTabRequest = z.infer<typeof VoidTabRequestSchema>;

// ---- Tickets ----

/** GET /bar/tickets: `status` is a comma list. */
export const TicketListQuerySchema = z.object({
  status: z
    .string()
    .default('NEW,PREPARING,READY')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(TicketStatusEnum).min(1)),
  station: z.string().trim().min(1).optional(),
});
export type TicketListQuery = z.infer<typeof TicketListQuerySchema>;

export const TicketSchema = z.object({
  id: UuidSchema,
  ticketNumber: z.number().int(),
  tab: z.object({ id: UuidSchema, tabNumber: z.number().int(), label: z.string() }),
  table: z.object({ name: z.string() }).nullable(),
  station: z.string(),
  status: TicketStatusEnum,
  createdAt: IsoDateTimeOutSchema,
  minutesWaiting: z.number().int().min(0),
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number().int().positive(),
      note: z.string().nullable(),
    }),
  ),
});
export type Ticket = z.infer<typeof TicketSchema>;
export const TicketListSchema = z.array(TicketSchema);

/** PATCH /bar/tickets/:id/status */
export const UpdateTicketStatusRequestSchema = z.object({
  status: z.enum(['PREPARING', 'READY', 'SERVED', 'CANCELLED']),
});
export type UpdateTicketStatusRequest = z.infer<typeof UpdateTicketStatusRequestSchema>;

// ---- Earnings ----

/** GET /bar/earnings */
export const BarEarningsQuerySchema = z.object({
  date: DateOnlySchema.optional(),
});
export type BarEarningsQuery = z.infer<typeof BarEarningsQuerySchema>;

export const BarEarningsSchema = z.object({
  date: DateOnlySchema,
  totalPaise: PaiseSchema,
  tabsSettled: z.number().int().min(0),
  averageTabPaise: PaiseSchema,
  byMethod: z.array(z.object({ method: PaymentMethodSchema, amountPaise: PaiseSchema })),
  byShift: z.array(
    z.object({
      shiftId: UuidSchema,
      employeeName: z.string(),
      startsAt: IsoDateTimeOutSchema,
      endsAt: IsoDateTimeOutSchema,
      amountPaise: PaiseSchema,
    }),
  ),
  topItems: z.array(z.object({ name: z.string(), qty: z.number().int(), amountPaise: PaiseSchema })),
});
export type BarEarnings = z.infer<typeof BarEarningsSchema>;
