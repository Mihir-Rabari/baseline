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

export const MenuCategoryEnum = z.enum(['DRINK', 'FOOD', 'SNACK']);
export const BarStationEnum = z.enum(['BAR', 'KITCHEN']);

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
  category: MenuCategoryEnum.optional(),
});
export type MenuQuery = z.infer<typeof MenuQuerySchema>;

/** POST /bar/menu */
export const CreateMenuItemRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: MenuCategoryEnum,
  station: BarStationEnum,
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

/** PATCH /bar/tabs/:id/items/:itemId: sets the quantity of one PENDING line (the +/- buttons). */
export const UpdateTabItemRequestSchema = z.object({
  qty: z.number().int().min(1).max(20),
});
export type UpdateTabItemRequest = z.infer<typeof UpdateTabItemRequestSchema>;

/** PATCH and DELETE /bar/tabs/:id/items/:itemId params */
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
  station: BarStationEnum.optional(),
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

// ---- Table Bookings (Issue #74) ----

export const BarTableBookingStatusEnum = z.enum(['CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED']);
export type BarTableBookingStatus = z.infer<typeof BarTableBookingStatusEnum>;

export const BarTableBookingSchema = z.object({
  id: UuidSchema,
  tableId: UuidSchema,
  tableName: z.string(),
  bookingDate: DateOnlySchema,
  startsAt: IsoDateTimeOutSchema,
  endsAt: IsoDateTimeOutSchema,
  guestName: z.string(),
  guestPhone: z.string().nullable().optional(),
  memberId: UuidSchema.nullable().optional(),
  memberName: z.string().nullable().optional(),
  partySize: z.number().int().positive().max(30),
  status: BarTableBookingStatusEnum,
  notes: z.string().nullable().optional(),
  tabId: UuidSchema.nullable().optional(),
  createdAt: IsoDateTimeOutSchema.optional(),
  updatedAt: IsoDateTimeOutSchema.optional(),
});
export type BarTableBooking = z.infer<typeof BarTableBookingSchema>;
export const BarTableBookingListSchema = z.array(BarTableBookingSchema);

/** GET /bar/bookings: query range & filters */
export const BarTableBookingListQuerySchema = z.object({
  date: DateOnlySchema.optional(),
  from: IsoDateTimeOutSchema.optional(),
  to: IsoDateTimeOutSchema.optional(),
  tableId: UuidSchema.optional(),
  status: BarTableBookingStatusEnum.optional(),
});
export type BarTableBookingListQuery = z.infer<typeof BarTableBookingListQuerySchema>;

/** POST /bar/bookings */
export const CreateBarTableBookingRequestSchema = z
  .object({
    tableId: UuidSchema,
    bookingDate: DateOnlySchema,
    startsAt: IsoDateTimeOutSchema,
    endsAt: IsoDateTimeOutSchema,
    guestName: z.string().trim().min(1).max(200),
    guestPhone: z.string().trim().max(30).optional(),
    memberId: UuidSchema.optional(),
    partySize: z.number().int().min(1).max(30).default(2),
    notes: z.string().trim().max(500).optional(),
  })
  .refine(
    (data) => new Date(data.startsAt).getTime() < new Date(data.endsAt).getTime(),
    {
      message: 'End time must be after start time',
      path: ['endsAt'],
    },
  );
export type CreateBarTableBookingRequest = z.infer<typeof CreateBarTableBookingRequestSchema>;

/** PATCH /bar/bookings/:id */
export const UpdateBarTableBookingRequestSchema = z
  .object({
    tableId: UuidSchema.optional(),
    bookingDate: DateOnlySchema.optional(),
    startsAt: IsoDateTimeOutSchema.optional(),
    endsAt: IsoDateTimeOutSchema.optional(),
    guestName: z.string().trim().min(1).max(200).optional(),
    guestPhone: z.string().trim().max(30).optional(),
    partySize: z.number().int().min(1).max(30).optional(),
    status: BarTableBookingStatusEnum.optional(),
    notes: z.string().trim().max(500).optional(),
    tabId: UuidSchema.nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.startsAt && data.endsAt) {
        return new Date(data.startsAt).getTime() < new Date(data.endsAt).getTime();
      }
      return true;
    },
    {
      message: 'End time must be after start time',
      path: ['endsAt'],
    },
  );
export type UpdateBarTableBookingRequest = z.infer<typeof UpdateBarTableBookingRequestSchema>;

