import { describe, it, expect } from 'vitest';
import {
  PlanSchema,
  UpdatePlanRequestSchema,
  MemberSchema,
  CreateMemberRequestSchema,
  CreateMemberResponseSchema,
  BookingSchema,
  CreateBookingRequestSchema,
  CancelBookingRequestSchema, bookingPayment,
  CreateTrialBookingRequestSchema,
  CreateTrialBookingResponseSchema,
  AvailabilitySchema,
  ProductSchema,
  OrderSchema,
  OnlineOrderRequestSchema,
  TabSchema,
  SettleTabRequestSchema,
  SettleTabResponseSchema,
  LeadSchema,
  QuoteSchema,
  CreateLeadRequestSchema,
  UpdateLeadRequestSchema,
  InvoiceSchema,
  CreateInvoiceRequestSchema,
  TaxSummarySchema,
  LeaveRequestSchema,
  DashboardReportSchema,
  SharedDashboardReportSchema,
  ReportRangeQuerySchema,
  NotificationSchema,
  HttpErrorResponseSchema,
  AvailabilityQuerySchema,
  MemberListQuerySchema,
  TicketListQuerySchema,
  IsoDateTimeOutSchema,
} from './index.js';

// ---- Fixtures copied from docs/hackathon/API_CONTRACT.md ----

const plan = {
  id: 'a0000000-0000-4000-8000-000000000001',
  code: 'GOLD',
  name: 'Gold',
  description: 'Full access, free court play',
  monthlyFeePaise: 300000,
  courtDiscountPct: 100,
  shopDiscountPct: 15,
  barDiscountPct: 10,
  maxBookingsPerDay: 2,
  bookingHorizonDays: 14,
  minAge: null,
  maxAge: null,
  isActive: true,
};

const memberSilver = {
  id: 'b0000000-0000-4000-8000-000000000001',
  memberCode: 'CC-000123',
  fullName: 'Aarav Mehta',
  phone: '+919876543210',
  email: 'aarav@example.com',
  dateOfBirth: '1994-05-17',
  photoUrl: null,
  hasLogin: true,
  membership: {
    id: 'b1000000-0000-4000-8000-000000000001',
    status: 'ACTIVE',
    plan: { id: 'a0000000-0000-4000-8000-000000000002', code: 'SILVER', name: 'Silver' },
    startsOn: '2026-09-20',
    endsOn: '2026-10-19',
    daysLeft: 16,
    expiryState: 'OK',
    cancelAtPeriodEnd: false,
    pendingPlan: null,
  },
  entitlements: {
    courtDiscountPct: 30,
    shopDiscountPct: 8,
    barDiscountPct: 5,
    maxBookingsPerDay: 2,
    bookingHorizonDays: 7,
  },
  createdAt: '2026-09-20T09:14:00.000Z',
};

const booking = {
  id: 'c0000000-0000-4000-8000-000000000001',
  court: { id: 'd0000000-0000-4000-8000-000000000001', name: 'Tennis Court 1', type: 'TENNIS' },
  kind: 'STANDARD',
  member: { id: 'b0000000-0000-4000-8000-000000000001', memberCode: 'CC-000123', fullName: 'Aarav Mehta' },
  guest: null,
  startsAt: '2026-10-09T12:30:00.000Z',
  endsAt: '2026-10-09T13:30:00.000Z',
  bookingDate: '2026-10-09',
  status: 'CONFIRMED',
  cancelledLate: false,
  channel: 'DESK',
  basePricePaise: 60000,
  discountPct: 30,
  pricePaise: 42000,
  paidPaise: 0,
  paymentStatus: 'UNPAID',
  socialSessionId: null,
  createdAt: '2026-10-09T10:00:00.000Z',
};

const trialBooking = {
  id: 'c0000000-0000-4000-8000-000000000009',
  court: { id: 'd0000000-0000-4000-8000-000000000003', name: 'Padel Court 1', type: 'PADEL' },
  kind: 'TRIAL',
  member: null,
  guest: { name: 'Riya Kapoor', phone: '+919811122233', email: 'riya@example.com' },
  startsAt: '2026-10-10T12:30:00.000Z',
  endsAt: '2026-10-10T13:30:00.000Z',
  bookingDate: '2026-10-10',
  status: 'CONFIRMED',
  cancelledLate: false,
  channel: 'WEBSITE_TRIAL',
  basePricePaise: 60000,
  discountPct: 0,
  pricePaise: 19900,
  paidPaise: 0,
  paymentStatus: 'UNPAID',
  socialSessionId: null,
  createdAt: '2026-10-09T09:00:00.000Z',
};

const product = {
  id: 'e0000000-0000-4000-8000-000000000001',
  sku: 'SHOE-CC-42',
  name: 'CourtPro Tennis Shoes (UK 8)',
  category: 'SHOE',
  imageUrl: null,
  pricePaise: 450000,
  yourPricePaise: 382500,
  discountPct: 15,
  stockQty: 1,
  inStock: true,
  lowStock: true,
  reorderLevel: 5,
  isActive: true,
};

const order = {
  id: 'f0000000-0000-4000-8000-000000000001',
  orderNumber: 'ORD-000045',
  channel: 'ONLINE',
  fulfilment: 'PICKUP',
  status: 'PLACED',
  member: { id: 'b0000000-0000-4000-8000-000000000001', memberCode: 'CC-000123', fullName: 'Aarav Mehta' },
  customerName: null,
  deliveryAddress: null,
  items: [
    {
      productId: 'e0000000-0000-4000-8000-000000000001',
      name: 'CourtPro Tennis Shoes (UK 8)',
      qty: 1,
      unitPricePaise: 450000,
      discountPct: 15,
      lineTotalPaise: 382500,
    },
  ],
  subtotalPaise: 450000,
  discountPaise: 67500,
  deliveryFeePaise: 0,
  totalPaise: 382500,
  paymentStatus: 'UNPAID',
  createdAt: '2026-10-09T10:05:00.000Z',
};

const tab = {
  id: '10000000-0000-4000-8000-000000000001',
  tabNumber: 218,
  status: 'OPEN',
  table: { id: '11000000-0000-4000-8000-000000000003', name: 'T3' },
  member: {
    id: 'b0000000-0000-4000-8000-000000000001',
    memberCode: 'CC-000123',
    fullName: 'Aarav Mehta',
    barDiscountPct: 5,
  },
  guestName: null,
  openedAt: '2026-10-09T13:40:00.000Z',
  items: [
    {
      id: '12000000-0000-4000-8000-000000000001',
      menuItemId: '13000000-0000-4000-8000-000000000001',
      name: 'Masala Fries',
      qty: 2,
      unitPricePaise: 18000,
      discountPct: 5,
      lineTotalPaise: 34200,
      status: 'SENT',
      ticketId: '14000000-0000-4000-8000-000000000001',
      note: 'extra spicy',
    },
  ],
  subtotalPaise: 36000,
  discountPaise: 1800,
  totalPaise: 34200,
  settledAt: null,
};

const lead = {
  id: '15000000-0000-4000-8000-000000000001',
  name: 'Riya Kapoor',
  phone: '+919811122233',
  email: 'riya@example.com',
  source: 'WEBSITE_ENQUIRY',
  status: 'NEW',
  interestedPlan: { id: 'a0000000-0000-4000-8000-000000000002', code: 'SILVER', name: 'Silver' },
  message: 'Interested in weekday evening padel for two.',
  // The contract writes the assignee id as an ellipsis placeholder; a real uuid is substituted here.
  assignedTo: { id: '20000000-0000-4000-8000-000000000001', name: 'Front Desk 1' },
  nextFollowUpAt: '2026-10-10T05:30:00.000Z',
  memberId: null,
  createdAt: '2026-10-09T09:00:00.000Z',
};

const invoice = {
  id: '16000000-0000-4000-8000-000000000001',
  invoiceNumber: 'INV-2026-0042',
  status: 'SENT',
  billTo: { type: 'BUSINESS_CLIENT', id: '17000000-0000-4000-8000-000000000001', name: 'Acme Corp' },
  issueDate: '2026-10-01',
  dueDate: '2026-10-16',
  lines: [
    { description: 'Corporate court block, 10 hours', qty: 10, unitPricePaise: 60000, lineTotalPaise: 600000 },
  ],
  subtotalPaise: 600000,
  taxPaise: 91525,
  totalPaise: 600000,
  paidPaise: 0,
  balancePaise: 600000,
  notes: null,
};

const notification = {
  id: '18000000-0000-4000-8000-000000000001',
  type: 'LOW_STOCK',
  title: 'Low stock: CourtPro Tennis Shoes (UK 8)',
  body: '1 left (reorder at 5)',
  link: '/inventory',
  readAt: null,
  createdAt: '2026-10-09T10:06:00.000Z',
};

const availability = {
  date: '2026-10-09',
  timezone: 'Asia/Kolkata',
  generatedAt: '2026-10-09T10:00:00.000Z',
  priceFor: { type: 'MEMBER', label: 'Silver', memberId: 'b0000000-0000-4000-8000-000000000001' },
  courts: [
    {
      courtId: 'd0000000-0000-4000-8000-000000000001',
      name: 'Tennis Court 1',
      type: 'TENNIS',
      mode: 'STANDARD',
      slots: [
        {
          startsAt: '2026-10-09T12:00:00.000Z',
          endsAt: '2026-10-09T13:00:00.000Z',
          status: 'BOOKED',
          pricePaise: 42000,
          bookingId: 'c0000000-0000-4000-8000-000000000020',
          holder: 'Aarav Mehta',
        },
        { startsAt: '2026-10-09T13:00:00.000Z', endsAt: '2026-10-09T14:00:00.000Z', status: 'FREE', pricePaise: 42000 },
        {
          startsAt: '2026-10-09T13:30:00.000Z',
          endsAt: '2026-10-09T14:30:00.000Z',
          status: 'BLOCKED',
          pricePaise: 42000,
          reason: 'Resurfacing',
        },
      ],
    },
    {
      courtId: 'd0000000-0000-4000-8000-000000000003',
      name: 'Padel Court 1',
      type: 'PADEL',
      mode: 'SOCIAL',
      slots: [
        {
          startsAt: '2026-10-09T12:30:00.000Z',
          endsAt: '2026-10-09T13:30:00.000Z',
          status: 'SOCIAL_OPEN',
          pricePaise: 14000,
          capacity: 4,
          spotsLeft: 1,
          socialSessionId: '1a000000-0000-4000-8000-000000000001',
        },
        {
          startsAt: '2026-10-09T13:30:00.000Z',
          endsAt: '2026-10-09T14:30:00.000Z',
          status: 'SOCIAL_FULL',
          pricePaise: 14000,
          capacity: 4,
          spotsLeft: 0,
        },
      ],
    },
  ],
  limits: { usedToday: 2, maxPerDay: 2 },
};

const dashboard = {
  range: 'today',
  from: '2026-10-09',
  to: '2026-10-09',
  generatedAt: '2026-10-09T14:21:00.000Z',
  kpis: {
    revenuePaise: 48750000,
    previousRevenuePaise: 41200000,
    changePct: 18,
    bookingsCount: 37,
    utilisationPct: 64,
    newMembers: 3,
    shopOrdersCount: 9,
    barTabsCount: 21,
  },
  bySource: [
    { source: 'COURT', amountPaise: 18200000 },
    { source: 'SHOP', amountPaise: 9300000 },
    { source: 'BAR', amountPaise: 16100000 },
    { source: 'MEMBERSHIP', amountPaise: 5150000 },
    { source: 'INVOICE', amountPaise: 0 },
  ],
  byMethod: [
    { method: 'CASH', amountPaise: 12100000 },
    { method: 'CARD', amountPaise: 15400000 },
    { method: 'UPI', amountPaise: 21250000 },
  ],
  trend: [
    {
      bucket: '2026-10-09T10:00',
      totalPaise: 2100000,
      bySource: { COURT: 1200000, SHOP: 400000, BAR: 500000, MEMBERSHIP: 0, INVOICE: 0 },
    },
  ],
  owed: { taxPayablePaise: 6120000, payrollDuePaise: 54000000, unpaidInvoicesPaise: 1800000, overdueInvoicesCount: 1 },
  alerts: { lowStockCount: 3, expiringMembershipsCount: 5, newLeadsCount: 2, pendingLeaveCount: 1 },
};

const memberFromCreateExample = {
  id: 'b0000000-0000-4000-8000-000000000001',
  memberCode: 'CC-000123',
  fullName: 'Aarav Mehta',
  phone: '+919876543210',
  email: 'aarav@example.com',
  dateOfBirth: '1994-05-17',
  photoUrl: null,
  hasLogin: false,
  membership: {
    id: 'b1000000-0000-4000-8000-000000000001',
    status: 'ACTIVE',
    plan: { id: 'a0000000-0000-4000-8000-000000000002', code: 'SILVER', name: 'Silver' },
    startsOn: '2026-10-09',
    endsOn: '2026-11-07',
    daysLeft: 29,
    expiryState: 'OK',
    cancelAtPeriodEnd: false,
    pendingPlan: null,
  },
  entitlements: {
    courtDiscountPct: 30,
    shopDiscountPct: 8,
    barDiscountPct: 5,
    maxBookingsPerDay: 2,
    bookingHorizonDays: 7,
  },
  createdAt: '2026-10-09T09:14:00.000Z',
};

const paidInvoice = {
  id: '16000000-0000-4000-8000-000000000010',
  invoiceNumber: 'INV-2026-0043',
  status: 'PAID',
  billTo: { type: 'MEMBER', id: 'b0000000-0000-4000-8000-000000000001', name: 'Aarav Mehta' },
  issueDate: '2026-10-09',
  dueDate: '2026-10-09',
  lines: [{ description: 'Silver membership, 30 days', qty: 1, unitPricePaise: 150000, lineTotalPaise: 150000 }],
  subtotalPaise: 150000,
  taxPaise: 22881,
  totalPaise: 150000,
  paidPaise: 150000,
  balancePaise: 0,
  notes: null,
};

describe('API_CONTRACT.md examples parse against the shared schemas', () => {
  describe('shared object shapes (section 1)', () => {
    it('Plan', () => expect(PlanSchema.parse(plan)).toEqual(plan));
    it('Member with membership', () => expect(MemberSchema.parse(memberSilver)).toEqual(memberSilver));
    it('Member with no membership (null)', () => {
      expect(MemberSchema.parse({ ...memberSilver, membership: null }).membership).toBeNull();
    });
    it('Booking', () => expect(BookingSchema.parse(booking)).toEqual(booking));
    it('Product', () => expect(ProductSchema.parse(product)).toEqual(product));
    it('Order', () => expect(OrderSchema.parse(order)).toEqual(order));
    it('Tab', () => expect(TabSchema.parse(tab)).toEqual(tab));
    it('Lead', () => expect(LeadSchema.parse(lead)).toEqual(lead));
    it('Invoice', () => expect(InvoiceSchema.parse(invoice)).toEqual(invoice));
    it('Notification', () => expect(NotificationSchema.parse(notification)).toEqual(notification));
  });

  describe('endpoint examples', () => {
    it('POST /members request and response (section 4)', () => {
      const req = {
        fullName: 'Aarav Mehta',
        phone: '+919876543210',
        email: 'aarav@example.com',
        dateOfBirth: '1994-05-17',
        planId: 'a0000000-0000-4000-8000-000000000002',
        paymentMethod: 'UPI',
      };
      expect(CreateMemberRequestSchema.parse(req)).toEqual(req);
      const res = {
        member: memberFromCreateExample,
        invoice: paidInvoice,
        payment: { id: '19000000-0000-4000-8000-000000000001', amountPaise: 150000, method: 'UPI' },
      };
      expect(CreateMemberResponseSchema.parse(res)).toEqual(res);
    });

    it('POST /public/trial-bookings request and response (section 3)', () => {
      const req = {
        courtId: 'd0000000-0000-4000-8000-000000000003',
        startsAt: '2026-10-10T12:30:00.000Z',
        name: 'Riya Kapoor',
        phone: '+919811122233',
        email: 'riya@example.com',
      };
      expect(CreateTrialBookingRequestSchema.parse(req)).toEqual(req);
      const res = {
        booking: trialBooking,
        leadId: '15000000-0000-4000-8000-000000000002',
        message: 'Trial booked. Pay at the club on arrival.',
      };
      expect(CreateTrialBookingResponseSchema.parse(res)).toEqual(res);
    });

    it('GET /courts/availability response (section 5.1)', () => {
      expect(AvailabilitySchema.parse(availability)).toEqual(availability);
    });

    it('POST /bookings request (section 5.2)', () => {
      const req = { courtId: 'd0000000-0000-4000-8000-000000000001', startsAt: '2026-10-09T12:30:00.000Z' };
      expect(CreateBookingRequestSchema.parse(req)).toEqual(req);
    });

    it('POST /bookings/:id/cancel requires a reason when overriding', () => {
      expect(CancelBookingRequestSchema.safeParse({ override: true }).success).toBe(false);
      expect(CancelBookingRequestSchema.safeParse({ override: true, reason: 'Court flooded' }).success).toBe(true);
      expect(CancelBookingRequestSchema.safeParse({}).success).toBe(true);
    });

    it('POST /bar/tabs/:id/settle request and response (section 7)', () => {
      const req = { payments: [{ method: 'UPI', reference: 'UPI-8837461' }] };
      expect(SettleTabRequestSchema.parse(req)).toEqual(req);
      const res = {
        tab: { ...tab, status: 'SETTLED', items: [], settledAt: '2026-10-09T14:20:00.000Z' },
        payments: [{ id: '19000000-0000-4000-8000-000000000020', method: 'UPI', amountPaise: 34200 }],
        receipt: { tabNumber: 218, totalPaise: 34200, discountPaise: 1800, paidAt: '2026-10-09T14:20:00.000Z' },
      };
      expect(SettleTabResponseSchema.parse(res)).toEqual(res);
    });

    it('GET /finance/tax-summary response (section 10.2)', () => {
      const res = {
        from: '2026-10-01',
        to: '2026-10-31',
        rows: [
          { source: 'COURT', grossPaise: 8120000, taxRateBp: 1800, taxPaise: 1238644, netPaise: 6881356 },
          { source: 'BAR', grossPaise: 4410000, taxRateBp: 500, taxPaise: 210000, netPaise: 4200000 },
        ],
        totals: { grossPaise: 12530000, taxPaise: 1448644, netPaise: 11081356 },
        note: 'Simplified: inclusive rates per source',
      };
      expect(TaxSummarySchema.parse(res)).toEqual(res);
    });

    it('LeaveRequest and Quote shapes (sections 9 and 10.3)', () => {
      const leave = {
        id: '21000000-0000-4000-8000-000000000001',
        employee: { id: '22000000-0000-4000-8000-000000000001', fullName: 'Sana Iyer' },
        leaveType: 'CASUAL',
        fromDate: '2026-10-12',
        toDate: '2026-10-13',
        days: 2,
        reason: null,
        status: 'PENDING',
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        createdAt: '2026-10-09T09:00:00.000Z',
      };
      expect(LeaveRequestSchema.parse(leave)).toEqual(leave);
      const quote = {
        id: '23000000-0000-4000-8000-000000000001',
        leadId: lead.id,
        plan: { id: 'a0000000-0000-4000-8000-000000000002', code: 'SILVER', name: 'Silver' },
        amountPaise: 150000,
        validUntil: '2026-10-23',
        status: 'SENT',
        notes: null,
        createdAt: '2026-10-09T09:30:00.000Z',
      };
      expect(QuoteSchema.parse(quote)).toEqual(quote);
    });

    it('GET /reports/dashboard response (section 11.1) and its public subset', () => {
      expect(DashboardReportSchema.parse(dashboard)).toEqual(dashboard);
      const shared = SharedDashboardReportSchema.parse(dashboard);
      expect(shared).not.toHaveProperty('owed');
      expect(shared).not.toHaveProperty('alerts');
    });
  });

  describe('error bodies (section 0.2)', () => {
    it('SLOT_TAKEN with details', () => {
      const body = {
        statusCode: 409,
        error: 'Conflict',
        message: 'That court is already booked for this time.',
        code: 'SLOT_TAKEN',
        requestId: 'req_1738800000000_ab12cd3',
        details: [{ field: 'startsAt', message: 'Court is busy 18:00–19:00', code: 'OVERLAP' }],
        timestamp: '2026-10-09T12:00:00.000Z',
      };
      expect(HttpErrorResponseSchema.parse(body)).toEqual(body);
    });

    it('DAILY_LIMIT_REACHED and OUT_OF_STOCK examples', () => {
      expect(
        HttpErrorResponseSchema.safeParse({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message: 'You already have 2 bookings on this day.',
          code: 'DAILY_LIMIT_REACHED',
          requestId: 'req_x',
        }).success,
      ).toBe(true);
      expect(
        HttpErrorResponseSchema.safeParse({
          statusCode: 409,
          error: 'Conflict',
          message: 'Not enough stock for CourtPro Tennis Shoes (UK 8): 0 left.',
          code: 'OUT_OF_STOCK',
          details: [{ field: 'items[0].productId', message: 'requested 1, available 0', code: 'OUT_OF_STOCK' }],
          requestId: 'req_x',
        }).success,
      ).toBe(true);
    });
  });
});

describe('contract schema behaviour', () => {
  it('response timestamps accept Date and emit ISO strings (IsoDateTimeOutSchema)', () => {
    const parsed = BookingSchema.parse({ ...booking, createdAt: new Date('2026-10-09T10:00:00.000Z') });
    expect(parsed.createdAt).toBe('2026-10-09T10:00:00.000Z');
    expect(IsoDateTimeOutSchema.safeParse(42).success).toBe(false);
  });

  it('rejects money as non-integers and percentages outside 0-100', () => {
    expect(BookingSchema.safeParse({ ...booking, pricePaise: 420.5 }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...plan, courtDiscountPct: 101 }).success).toBe(false);
    expect(UpdatePlanRequestSchema.safeParse({ shopDiscountPct: -1 }).success).toBe(false);
    expect(UpdatePlanRequestSchema.safeParse({ shopDiscountPct: 0, barDiscountPct: 100 }).success).toBe(true);
  });

  it('rejects malformed ids, missing fields and bad business dates', () => {
    expect(BookingSchema.safeParse({ ...booking, id: 'not-a-uuid' }).success).toBe(false);
    expect(BookingSchema.safeParse({ ...booking, court: undefined }).success).toBe(false);
    expect(BookingSchema.safeParse({ ...booking, bookingDate: '2026-02-30' }).success).toBe(false);
    expect(BookingSchema.safeParse({ ...booking, status: 'BOGUS' }).success).toBe(false);
  });

  it('create booking: rejects blank court, bad instant, and memberId plus guest together', () => {
    const base = { courtId: 'd0000000-0000-4000-8000-000000000001', startsAt: '2026-10-09T12:30:00.000Z' };
    expect(CreateBookingRequestSchema.safeParse({ ...base, courtId: '' }).success).toBe(false);
    expect(CreateBookingRequestSchema.safeParse({ ...base, startsAt: 'tomorrow' }).success).toBe(false);
    expect(
      CreateBookingRequestSchema.safeParse({
        ...base,
        memberId: 'b0000000-0000-4000-8000-000000000001',
        guest: { name: 'A', phone: '+919811122233' },
      }).success,
    ).toBe(false);
  });

  it('member list/lookup queries enforce min 2 char search and bounded limits', () => {
    expect(MemberListQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(MemberListQuerySchema.parse({ q: 'aa' }).limit).toBe(20);
    expect(MemberListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(MemberListQuerySchema.safeParse({ status: 'WHATEVER' }).success).toBe(false);
  });

  it('availability query requires a real date', () => {
    expect(AvailabilityQuerySchema.safeParse({}).success).toBe(false);
    expect(AvailabilityQuerySchema.safeParse({ date: '2026-13-01' }).success).toBe(false);
    expect(AvailabilityQuerySchema.safeParse({ date: '2026-10-09' }).success).toBe(true);
  });

  it('online order needs an address for DELIVERY and UPI-only payNow', () => {
    const items = [{ productId: 'e0000000-0000-4000-8000-000000000001', qty: 1 }];
    expect(OnlineOrderRequestSchema.safeParse({ items, fulfilment: 'DELIVERY' }).success).toBe(false);
    expect(
      OnlineOrderRequestSchema.safeParse({ items, fulfilment: 'DELIVERY', deliveryAddress: '12 MG Road' }).success,
    ).toBe(true);
    expect(
      OnlineOrderRequestSchema.safeParse({ items, fulfilment: 'PICKUP', payNow: { method: 'CASH' } }).success,
    ).toBe(false);
    expect(OnlineOrderRequestSchema.safeParse({ items: [], fulfilment: 'PICKUP' }).success).toBe(false);
  });

  it('lead rules: phone or email required, LOST requires a reason, WON is not settable', () => {
    expect(CreateLeadRequestSchema.safeParse({ name: 'X', source: 'WALK_IN' }).success).toBe(false);
    expect(CreateLeadRequestSchema.safeParse({ name: 'X', source: 'WALK_IN', phone: '+919811122233' }).success).toBe(true);
    expect(UpdateLeadRequestSchema.safeParse({ status: 'LOST' }).success).toBe(false);
    expect(UpdateLeadRequestSchema.safeParse({ status: 'LOST', lostReason: 'Too far' }).success).toBe(true);
    expect(UpdateLeadRequestSchema.safeParse({ status: 'WON' }).success).toBe(false);
  });

  it('invoice request: exactly one bill-to, 1-50 lines, due not before issue', () => {
    const line = { description: 'Court block', qty: 1, unitPricePaise: 60000 };
    const memberId = 'b0000000-0000-4000-8000-000000000001';
    const businessClientId = '17000000-0000-4000-8000-000000000001';
    expect(CreateInvoiceRequestSchema.safeParse({ lines: [line] }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ memberId, businessClientId, lines: [line] }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ memberId, lines: [] }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ memberId, lines: Array(51).fill(line) }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ memberId, lines: Array(50).fill(line) }).success).toBe(true);
    expect(
      CreateInvoiceRequestSchema.safeParse({ memberId, lines: [line], issueDate: '2026-10-10', dueDate: '2026-10-09' })
        .success,
    ).toBe(false);
  });

  it('report range: from and to travel together and are ordered', () => {
    expect(ReportRangeQuerySchema.safeParse({ range: 'week' }).success).toBe(true);
    expect(ReportRangeQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(ReportRangeQuerySchema.safeParse({ from: '2026-10-01' }).success).toBe(false);
    expect(ReportRangeQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(false);
    expect(ReportRangeQuerySchema.safeParse({ range: 'year' }).success).toBe(false);
  });

  it('ticket status query parses a comma list with the contract default', () => {
    expect(TicketListQuerySchema.parse({}).status).toEqual(['NEW', 'PREPARING', 'READY']);
    expect(TicketListQuerySchema.parse({ status: 'READY,SERVED' }).status).toEqual(['READY', 'SERVED']);
    expect(TicketListQuerySchema.safeParse({ status: 'NEW,BOGUS' }).success).toBe(false);
  });
});

describe('bookingPayment', () => {
  it('splits a cash booking into the promise fee paid and the rest due at the club', () => {
    expect(bookingPayment({ paymentStatus: 'PARTIAL', pricePaise: 100000 })).toEqual({ paidPaise: 20000, duePaise: 80000 });
    expect(bookingPayment({ paymentStatus: 'PARTIAL', pricePaise: 1 })).toEqual({ paidPaise: 1, duePaise: 0 });
  });
  it('has nothing due once paid and nothing paid while unpaid or waived', () => {
    expect(bookingPayment({ paymentStatus: 'PAID', pricePaise: 50000 })).toEqual({ paidPaise: 50000, duePaise: 0 });
    for (const paymentStatus of ['UNPAID', 'WAIVED', 'REFUNDED']) expect(bookingPayment({ paymentStatus, pricePaise: 50000 })).toEqual({ paidPaise: 0, duePaise: 0 });
  });
});
