import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  barTables,
  employees,
  kitchenTickets,
  members,
  memberships,
  menuItems,
  payments,
  plans,
  staffShifts,
  tabItems,
  tabs,
  type DatabaseInstance,
  type PaymentMethod,
  type TicketStatus,
} from '@packages/db';
import { getEnv } from '@packages/config/env';
import type {
  AddTabItemRequest,
  BarEarnings,
  CreateMenuItemRequest,
  MenuItem,
  OpenTabRequest,
  SendTabResponse,
  SettleTabRequest,
  SettleTabResponse,
  Tab,
  TabListQuery,
  TabSummary,
  Ticket,
  TicketListQuery,
  UpdateMenuItemRequest,
} from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { clubDateOf } from '../lib/club-date.js';
import type { DbExecutor } from './db-types.js';
import { PaymentService } from './payment.service.js';

type Tx = Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];

export interface BarServiceOptions {
  timeZone?: string;
  now?: () => Date;
}

/** Allowed ticket moves. CANCELLED is reachable from any state that has not finished. */
const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: [],
  CANCELLED: [],
};

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** BR-05 style integer rounding: `round(gross * (100 - pct) / 100)`. */
export function discountedLine(unitPricePaise: number, qty: number, discountPct: number): number {
  return Math.round((unitPricePaise * qty * (100 - discountPct)) / 100);
}

function menuRow(row: typeof menuItems.$inferSelect): MenuItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    station: row.station,
    pricePaise: row.pricePaise,
    discountable: row.discountable,
    isAvailable: row.isAvailable,
  };
}

/**
 * Bar tabs, kitchen tickets and earnings.
 *
 * Money rules: every line snapshots its price and the member discount at the moment it is added,
 * so a later menu or plan change never rewrites a bill. A tab is settled exactly once: settling
 * locks the tab row, freezes the totals on it and writes one ledger row per payment method.
 */
export class BarService {
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseInstance,
    options: BarServiceOptions = {}
  ) {
    this.timeZone = options.timeZone ?? getEnv().CLUB_TIMEZONE;
    this.now = options.now ?? (() => new Date());
  }

  // ------------------------------------------------------------------ menu

  async listMenu(category?: string): Promise<MenuItem[]> {
    const rows = await this.db
      .select()
      .from(menuItems)
      .where(category ? eq(menuItems.category, category as 'DRINK') : undefined)
      .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
    return rows.map(menuRow);
  }

  async createMenuItem(input: CreateMenuItemRequest): Promise<MenuItem> {
    const [row] = await this.db
      .insert(menuItems)
      .values({
        name: input.name,
        category: input.category,
        station: input.station,
        pricePaise: input.pricePaise,
        discountable: input.discountable ?? true,
      })
      .returning();
    return menuRow(row);
  }

  async updateMenuItem(id: string, input: UpdateMenuItemRequest): Promise<MenuItem> {
    const patch: Partial<typeof menuItems.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.category !== undefined) patch.category = input.category;
    if (input.station !== undefined) patch.station = input.station;
    if (input.pricePaise !== undefined) patch.pricePaise = input.pricePaise;
    if (input.discountable !== undefined) patch.discountable = input.discountable;
    if (input.isAvailable !== undefined) patch.isAvailable = input.isAvailable;

    const [row] =
      Object.keys(patch).length === 0
        ? await this.db.select().from(menuItems).where(eq(menuItems.id, id))
        : await this.db.update(menuItems).set(patch).where(eq(menuItems.id, id)).returning();
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Menu item not found');
    return menuRow(row);
  }

  // ----------------------------------------------------------------- tables

  async listTables() {
    const tables = await this.db
      .select()
      .from(barTables)
      .where(eq(barTables.isActive, true))
      .orderBy(asc(barTables.name));

    const open = await this.db
      .select({
        id: tabs.id,
        tableId: tabs.tableId,
        tabNumber: tabs.tabNumber,
        openedAt: tabs.openedAt,
        guestName: tabs.guestName,
        memberName: members.fullName,
      })
      .from(tabs)
      .leftJoin(members, eq(members.id, tabs.memberId))
      .where(eq(tabs.status, 'OPEN'));

    const totals = await this.liveTotals(open.map((t) => t.id));
    const byTable = new Map(open.filter((t) => t.tableId).map((t) => [t.tableId as string, t]));

    return tables.map((table) => {
      const tab = byTable.get(table.id);
      return {
        id: table.id,
        name: table.name,
        seats: table.seats,
        status: tab ? ('OCCUPIED' as const) : ('FREE' as const),
        openTab: tab
          ? {
              id: tab.id,
              tabNumber: tab.tabNumber,
              label: tab.memberName ?? tab.guestName ?? `Tab ${tab.tabNumber}`,
              totalPaise: totals.get(tab.id)?.total ?? 0,
              openedAt: tab.openedAt.toISOString(),
            }
          : null,
      };
    });
  }

  // ------------------------------------------------------------------- tabs

  async openTab(input: OpenTabRequest, actorId: string): Promise<Tab> {
    if (input.memberId) {
      const [member] = await this.db.select({ id: members.id }).from(members).where(eq(members.id, input.memberId));
      if (!member) throw new DomainError('NOT_FOUND', 404, 'Member not found');
    }
    if (input.tableId) {
      const [table] = await this.db
        .select({ id: barTables.id })
        .from(barTables)
        .where(and(eq(barTables.id, input.tableId), eq(barTables.isActive, true)));
      if (!table) throw new DomainError('NOT_FOUND', 404, 'Table not found');
    }

    let id: string;
    try {
      const [row] = await this.db
        .insert(tabs)
        .values({
          tabNumber: sql`nextval('tab_number_seq')`,
          memberId: input.memberId ?? null,
          guestName: input.guestName ?? null,
          tableId: input.tableId ?? null,
          openedBy: actorId,
        })
        .returning({ id: tabs.id });
      id = row.id;
    } catch (error) {
      // The partial unique index uq_tabs_one_open_per_table is the real guard against two
      // staff opening the same table at once; the database error becomes the contract error.
      if (pgCode(error) === '23505') {
        throw new DomainError('TABLE_OCCUPIED', 409, 'That table already has an open tab');
      }
      throw error;
    }
    return this.getTab(id);
  }

  async getTab(id: string, executor: DbExecutor = this.db): Promise<Tab> {
    const [row] = await executor
      .select({
        tab: tabs,
        tableName: barTables.name,
        memberCode: members.memberCode,
        memberName: members.fullName,
      })
      .from(tabs)
      .leftJoin(barTables, eq(barTables.id, tabs.tableId))
      .leftJoin(members, eq(members.id, tabs.memberId))
      .where(eq(tabs.id, id));
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Tab not found');

    const items = await executor
      .select()
      .from(tabItems)
      .where(eq(tabItems.tabId, id))
      .orderBy(asc(tabItems.createdAt), asc(tabItems.id));

    const live = this.sumLines(items);
    const settled = row.tab.status === 'SETTLED';
    const subtotal = settled ? (row.tab.subtotalPaise ?? live.subtotal) : live.subtotal;
    const discount = settled ? (row.tab.discountPaise ?? live.discount) : live.discount;
    const total = settled ? (row.tab.totalPaise ?? live.total) : live.total;

    return {
      id: row.tab.id,
      tabNumber: row.tab.tabNumber,
      status: row.tab.status,
      table: row.tab.tableId && row.tableName ? { id: row.tab.tableId, name: row.tableName } : null,
      member:
        row.tab.memberId && row.memberCode && row.memberName
          ? {
              id: row.tab.memberId,
              memberCode: row.memberCode,
              fullName: row.memberName,
              barDiscountPct: await this.memberBarDiscount(row.tab.memberId, executor),
            }
          : null,
      guestName: row.tab.guestName,
      openedAt: row.tab.openedAt.toISOString(),
      items: items.map((item) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        name: item.nameSnapshot,
        qty: item.qty,
        unitPricePaise: item.unitPricePaise,
        discountPct: item.discountPct,
        lineTotalPaise: item.lineTotalPaise,
        status: item.status,
        ticketId: item.ticketId,
        note: item.note,
      })),
      subtotalPaise: subtotal,
      discountPaise: discount,
      totalPaise: total,
      settledAt: row.tab.settledAt ? row.tab.settledAt.toISOString() : null,
    };
  }

  async listTabs(query: TabListQuery): Promise<{ rows: TabSummary[]; total: number }> {
    const dateColumn = query.status === 'SETTLED' ? tabs.settledAt : tabs.openedAt;
    const where = and(
      eq(tabs.status, query.status),
      query.date
        ? sql`(${dateColumn} AT TIME ZONE ${this.timeZone})::date = ${query.date}::date`
        : undefined
    );

    const [{ value: total }] = await this.db.select({ value: count() }).from(tabs).where(where);
    const ids = await this.db
      .select({ id: tabs.id })
      .from(tabs)
      .where(where)
      .orderBy(desc(tabs.openedAt), desc(tabs.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    const rows: TabSummary[] = [];
    for (const { id } of ids) {
      const { items, ...summary } = await this.getTab(id);
      rows.push({ ...summary, itemCount: items.filter((i) => i.status !== 'VOID').length });
    }
    return { rows, total };
  }

  async addItem(tabId: string, input: AddTabItemRequest, actorId: string): Promise<Tab> {
    await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, tabId);
      this.assertOpen(tab.status);

      const [menuItem] = await tx.select().from(menuItems).where(eq(menuItems.id, input.menuItemId));
      if (!menuItem) throw new DomainError('NOT_FOUND', 404, 'Menu item not found');
      if (!menuItem.isAvailable) {
        throw new DomainError('ITEM_UNAVAILABLE', 409, `${menuItem.name} is not available right now`);
      }

      const memberPct = tab.memberId ? await this.memberBarDiscount(tab.memberId, tx) : 0;
      const discountPct = menuItem.discountable ? memberPct : 0;
      await tx.insert(tabItems).values({
        tabId,
        menuItemId: menuItem.id,
        nameSnapshot: menuItem.name,
        qty: input.qty,
        unitPricePaise: menuItem.pricePaise,
        discountPct,
        lineTotalPaise: discountedLine(menuItem.pricePaise, input.qty, discountPct),
        note: input.note ?? null,
        createdBy: actorId,
      });
    });
    return this.getTab(tabId);
  }

  /** `isOwner` lifts the "PENDING items only" limit that applies to bar staff. */
  async removeItem(tabId: string, itemId: string, isOwner: boolean): Promise<Tab> {
    await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, tabId);
      this.assertOpen(tab.status);

      const [item] = await tx
        .select()
        .from(tabItems)
        .where(and(eq(tabItems.id, itemId), eq(tabItems.tabId, tabId)));
      if (!item) throw new DomainError('NOT_FOUND', 404, 'Item not found on this tab');
      if (item.status === 'VOID') {
        throw new DomainError('ITEM_ALREADY_VOID', 409, 'That item has already been removed');
      }
      if (item.status === 'SENT' && !isOwner) {
        throw new DomainError('FORBIDDEN', 403, 'Only the owner can remove an item already sent to the kitchen');
      }
      await tx.update(tabItems).set({ status: 'VOID' }).where(eq(tabItems.id, itemId));
    });
    return this.getTab(tabId);
  }

  async sendToKitchen(tabId: string, actorId: string): Promise<SendTabResponse> {
    const created = await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, tabId);
      this.assertOpen(tab.status);

      const pending = await tx
        .select({ id: tabItems.id, station: menuItems.station })
        .from(tabItems)
        .innerJoin(menuItems, eq(menuItems.id, tabItems.menuItemId))
        .where(and(eq(tabItems.tabId, tabId), eq(tabItems.status, 'PENDING')));
      if (pending.length === 0) throw new DomainError('TAB_EMPTY', 422, 'There is nothing new to send to the kitchen');

      const byStation = new Map<'BAR' | 'KITCHEN', string[]>();
      for (const item of pending) {
        byStation.set(item.station, [...(byStation.get(item.station) ?? []), item.id]);
      }

      const tickets: SendTabResponse['tickets'] = [];
      for (const [station, itemIds] of byStation) {
        const [ticket] = await tx
          .insert(kitchenTickets)
          .values({ tabId, station, createdBy: actorId })
          .returning({ id: kitchenTickets.id });
        await tx
          .update(tabItems)
          .set({ status: 'SENT', ticketId: ticket.id })
          .where(inArray(tabItems.id, itemIds));
        tickets.push({ id: ticket.id, station, status: 'NEW', itemCount: itemIds.length });
      }
      return tickets;
    });
    return { tab: await this.getTab(tabId), tickets: created };
  }

  async settle(tabId: string, input: SettleTabRequest, actorId: string): Promise<SettleTabResponse> {
    const paidAt = this.now();
    const result = await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, tabId);
      if (tab.status === 'SETTLED') throw new DomainError('ALREADY_SETTLED', 409, 'This tab has already been settled');
      this.assertOpen(tab.status);

      const items = await tx.select().from(tabItems).where(eq(tabItems.tabId, tabId));
      const totals = this.sumLines(items);
      if (items.every((i) => i.status === 'VOID')) {
        throw new DomainError('TAB_EMPTY', 422, 'There is nothing on this tab to bill');
      }

      const plan = this.planPayments(input, totals.total);

      // The lock above already serialises settlers; the status guard stays as the documented
      // single-settle mechanism (ARCHITECTURE 3.5) and protects against any future caller
      // that reaches this statement without the lock.
      const updated = await tx
        .update(tabs)
        .set({
          status: 'SETTLED',
          settledBy: actorId,
          settledAt: paidAt,
          subtotalPaise: totals.subtotal,
          discountPaise: totals.discount,
          totalPaise: totals.total,
        })
        .where(and(eq(tabs.id, tabId), eq(tabs.status, 'OPEN')))
        .returning({ id: tabs.id });
      if (updated.length === 0) throw new DomainError('ALREADY_SETTLED', 409, 'This tab has already been settled');

      const ledger = new PaymentService(tx);
      const receipts: SettleTabResponse['payments'] = [];
      for (const part of plan) {
        const row = await ledger.record({
          source: 'BAR',
          sourceId: tabId,
          amountPaise: part.amountPaise,
          method: part.method,
          memberId: tab.memberId,
          receivedBy: actorId,
          reference: part.reference,
          paidAt,
        });
        receipts.push({ id: row.id, method: row.method, amountPaise: Math.abs(row.amountPaise) });
        if (row.shiftId) await tx.update(tabs).set({ shiftId: row.shiftId }).where(eq(tabs.id, tabId));
      }
      return { totals, receipts };
    });

    const settledTab = await this.getTab(tabId);
    return {
      tab: settledTab,
      payments: result.receipts,
      receipt: {
        tabNumber: settledTab.tabNumber,
        totalPaise: result.totals.total,
        discountPaise: result.totals.discount,
        paidAt: paidAt.toISOString(),
      },
    };
  }

  async voidTab(tabId: string, actorId: string): Promise<Tab> {
    await this.db.transaction(async (tx) => {
      const tab = await this.lockTab(tx, tabId);
      if (tab.status === 'SETTLED') {
        throw new DomainError('ALREADY_SETTLED', 409, 'A settled tab cannot be voided');
      }
      this.assertOpen(tab.status);

      await tx.update(tabItems).set({ status: 'VOID' }).where(eq(tabItems.tabId, tabId));
      await tx
        .update(kitchenTickets)
        .set({ status: 'CANCELLED', updatedAt: this.now() })
        .where(and(eq(kitchenTickets.tabId, tabId), inArray(kitchenTickets.status, ['NEW', 'PREPARING', 'READY'])));
      await tx
        .update(tabs)
        .set({ status: 'VOID', settledBy: actorId, settledAt: this.now(), subtotalPaise: 0, discountPaise: 0, totalPaise: 0 })
        .where(eq(tabs.id, tabId));
    });
    return this.getTab(tabId);
  }

  // ---------------------------------------------------------------- tickets

  async listTickets(query: TicketListQuery): Promise<Ticket[]> {
    const rows = await this.db
      .select({
        ticket: kitchenTickets,
        tabNumber: tabs.tabNumber,
        guestName: tabs.guestName,
        memberName: members.fullName,
        tableName: barTables.name,
      })
      .from(kitchenTickets)
      .innerJoin(tabs, eq(tabs.id, kitchenTickets.tabId))
      .leftJoin(members, eq(members.id, tabs.memberId))
      .leftJoin(barTables, eq(barTables.id, tabs.tableId))
      .where(
        and(
          inArray(kitchenTickets.status, query.status),
          query.station ? eq(kitchenTickets.station, query.station) : undefined
        )
      )
      .orderBy(asc(kitchenTickets.createdAt), asc(kitchenTickets.ticketNumber));
    return this.hydrateTickets(rows);
  }

  async updateTicketStatus(id: string, next: TicketStatus): Promise<Ticket> {
    const [current] = await this.db.select().from(kitchenTickets).where(eq(kitchenTickets.id, id));
    if (!current) throw new DomainError('NOT_FOUND', 404, 'Ticket not found');

    const invalid = () =>
      new DomainError('ORDER_STATE_INVALID', 409, `A ticket that is ${current.status.toLowerCase()} cannot become ${next.toLowerCase()}`);
    if (!TICKET_TRANSITIONS[current.status].includes(next)) throw invalid();

    await this.db.transaction(async (tx) => {
      // Guarded on the status we validated against, so two racing moves cannot both win.
      const moved = await tx
        .update(kitchenTickets)
        .set({ status: next, updatedAt: this.now() })
        .where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.status, current.status)))
        .returning({ id: kitchenTickets.id });
      if (moved.length === 0) throw invalid();
      if (next === 'CANCELLED') {
        // Cancelled food must not be billed. A settled tab's bill is history, so it is left alone.
        const [tab] = await tx.select({ status: tabs.status }).from(tabs).where(eq(tabs.id, current.tabId));
        if (tab?.status === 'OPEN') {
          await tx
            .update(tabItems)
            .set({ status: 'VOID' })
            .where(and(eq(tabItems.ticketId, id), eq(tabItems.status, 'SENT')));
        }
      }
    });

    const [ticket] = await this.listTicketsById(id);
    return ticket;
  }

  // --------------------------------------------------------------- earnings

  async earnings(date: string | undefined): Promise<BarEarnings> {
    const day = date ?? clubDateOf(this.now(), this.timeZone);
    const onDay = sql`(${payments.paidAt} AT TIME ZONE ${this.timeZone})::date = ${day}::date`;
    const barPayments = and(eq(payments.source, 'BAR'), onDay);

    const [totalRow] = await this.db
      .select({ total: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` })
      .from(payments)
      .where(barPayments);
    const totalPaise = Number(totalRow?.total ?? 0);

    const [tabRow] = await this.db
      .select({ value: count() })
      .from(tabs)
      .where(and(eq(tabs.status, 'SETTLED'), sql`(${tabs.settledAt} AT TIME ZONE ${this.timeZone})::date = ${day}::date`));
    const tabsSettled = tabRow?.value ?? 0;

    const methodRows = await this.db
      .select({ method: payments.method, amount: sql<string>`sum(${payments.amountPaise})` })
      .from(payments)
      .where(barPayments)
      .groupBy(payments.method)
      .orderBy(asc(payments.method));

    const shiftRows = await this.db
      .select({
        shiftId: payments.shiftId,
        employeeName: employees.fullName,
        startsAt: staffShifts.startsAt,
        endsAt: staffShifts.endsAt,
        amount: sql<string>`sum(${payments.amountPaise})`,
      })
      .from(payments)
      .innerJoin(staffShifts, eq(staffShifts.id, payments.shiftId))
      .innerJoin(employees, eq(employees.id, staffShifts.employeeId))
      .where(barPayments)
      .groupBy(payments.shiftId, employees.fullName, staffShifts.startsAt, staffShifts.endsAt)
      .orderBy(asc(staffShifts.startsAt));

    const topRows = await this.db
      .select({
        name: tabItems.nameSnapshot,
        qty: sql<string>`sum(${tabItems.qty})`,
        amount: sql<string>`sum(${tabItems.lineTotalPaise})`,
      })
      .from(tabItems)
      .innerJoin(tabs, eq(tabs.id, tabItems.tabId))
      .where(
        and(
          eq(tabs.status, 'SETTLED'),
          sql`(${tabs.settledAt} AT TIME ZONE ${this.timeZone})::date = ${day}::date`,
          sql`${tabItems.status} <> 'VOID'`
        )
      )
      .groupBy(tabItems.nameSnapshot)
      .orderBy(sql`sum(${tabItems.lineTotalPaise}) desc`, asc(tabItems.nameSnapshot))
      .limit(10);

    return {
      date: day,
      totalPaise,
      tabsSettled,
      averageTabPaise: tabsSettled > 0 ? Math.round(totalPaise / tabsSettled) : 0,
      byMethod: methodRows.map((r) => ({ method: r.method as PaymentMethod, amountPaise: Number(r.amount) })),
      byShift: shiftRows.map((r) => ({
        shiftId: r.shiftId as string,
        employeeName: r.employeeName,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        amountPaise: Number(r.amount),
      })),
      topItems: topRows.map((r) => ({ name: r.name, qty: Number(r.qty), amountPaise: Number(r.amount) })),
    };
  }

  /** Today's date in the club zone; the route uses it to confine bar staff to the current day. */
  clubToday(): string {
    return clubDateOf(this.now(), this.timeZone);
  }

  // ---------------------------------------------------------------- helpers

  private async lockTab(tx: Tx, id: string): Promise<typeof tabs.$inferSelect> {
    const [tab] = await tx.select().from(tabs).where(eq(tabs.id, id)).for('update');
    if (!tab) throw new DomainError('NOT_FOUND', 404, 'Tab not found');
    return tab;
  }

  private assertOpen(status: string): void {
    if (status !== 'OPEN') throw new DomainError('TAB_NOT_OPEN', 409, `This tab is ${status.toLowerCase()}`);
  }

  private sumLines(items: Array<typeof tabItems.$inferSelect>) {
    let subtotal = 0;
    let total = 0;
    for (const item of items) {
      if (item.status === 'VOID') continue;
      subtotal += item.unitPricePaise * item.qty;
      total += item.lineTotalPaise;
    }
    return { subtotal, total, discount: subtotal - total };
  }

  private async liveTotals(tabIds: string[]): Promise<Map<string, { total: number }>> {
    if (tabIds.length === 0) return new Map();
    const rows = await this.db
      .select({ tabId: tabItems.tabId, total: sql<string>`sum(${tabItems.lineTotalPaise})` })
      .from(tabItems)
      .where(and(inArray(tabItems.tabId, tabIds), sql`${tabItems.status} <> 'VOID'`))
      .groupBy(tabItems.tabId);
    return new Map(rows.map((r) => [r.tabId, { total: Number(r.total) }]));
  }

  /** The bar discount of a member's current plan; 0 for lapsed memberships and walk-ins (BR-07). */
  private async memberBarDiscount(memberId: string, executor: DbExecutor): Promise<number> {
    const today = clubDateOf(this.now(), this.timeZone);
    const [row] = await executor
      .select({ pct: plans.barDiscountPct })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(and(eq(memberships.memberId, memberId), eq(memberships.status, 'ACTIVE'), gte(memberships.endsOn, today)))
      .limit(1);
    return row?.pct ?? 0;
  }

  /**
   * Turns the request into concrete amounts. One entry may omit the amount (it pays the full
   * total); several entries must each carry an amount and sum to the total exactly.
   */
  private planPayments(input: SettleTabRequest, total: number) {
    const mismatch = (message: string) =>
      new DomainError('VALIDATION_ERROR', 400, message, [{ field: 'payments', message, code: 'AMOUNT_MISMATCH' }]);

    if (total === 0) return [];
    if (input.payments.length === 1) {
      const [only] = input.payments;
      if (only.amountPaise !== undefined && only.amountPaise !== total) {
        throw mismatch(`The payment must equal the tab total of ${total} paise`);
      }
      return [{ method: only.method, amountPaise: total, reference: only.reference ?? null }];
    }
    if (input.payments.some((p) => p.amountPaise === undefined)) {
      throw mismatch('Every payment needs an amount when a tab is split');
    }
    const sum = input.payments.reduce((acc, p) => acc + (p.amountPaise as number), 0);
    if (sum !== total) throw mismatch(`The payments add up to ${sum} paise but the tab total is ${total} paise`);
    return input.payments.map((p) => ({
      method: p.method,
      amountPaise: p.amountPaise as number,
      reference: p.reference ?? null,
    }));
  }

  private async listTicketsById(id: string): Promise<Ticket[]> {
    const rows = await this.db
      .select({
        ticket: kitchenTickets,
        tabNumber: tabs.tabNumber,
        guestName: tabs.guestName,
        memberName: members.fullName,
        tableName: barTables.name,
      })
      .from(kitchenTickets)
      .innerJoin(tabs, eq(tabs.id, kitchenTickets.tabId))
      .leftJoin(members, eq(members.id, tabs.memberId))
      .leftJoin(barTables, eq(barTables.id, tabs.tableId))
      .where(eq(kitchenTickets.id, id));
    return this.hydrateTickets(rows);
  }

  private async hydrateTickets(
    rows: Array<{
      ticket: typeof kitchenTickets.$inferSelect;
      tabNumber: number;
      guestName: string | null;
      memberName: string | null;
      tableName: string | null;
    }>
  ): Promise<Ticket[]> {
    if (rows.length === 0) return [];
    const items = await this.db
      .select()
      .from(tabItems)
      .where(and(inArray(tabItems.ticketId, rows.map((r) => r.ticket.id)), sql`${tabItems.status} <> 'VOID'`))
      .orderBy(asc(tabItems.createdAt), asc(tabItems.id));

    const nowMs = this.now().getTime();
    return rows.map((r) => ({
      id: r.ticket.id,
      ticketNumber: r.ticket.ticketNumber,
      tab: {
        id: r.ticket.tabId,
        tabNumber: r.tabNumber,
        label: r.memberName ?? r.guestName ?? `Tab ${r.tabNumber}`,
      },
      table: r.tableName ? { name: r.tableName } : null,
      station: r.ticket.station,
      status: r.ticket.status,
      createdAt: r.ticket.createdAt.toISOString(),
      minutesWaiting: Math.max(0, Math.floor((nowMs - r.ticket.createdAt.getTime()) / 60_000)),
      items: items
        .filter((i) => i.ticketId === r.ticket.id)
        .map((i) => ({ name: i.nameSnapshot, qty: i.qty, note: i.note })),
    }));
  }
}
