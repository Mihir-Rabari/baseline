import { describe, expect, it } from 'vitest';
import { bookingPayload, calendarDate, dateAfter, slotTime } from './booking-calendar';

const selection = { courtId: 'd0000000-0000-4000-8000-000000000001', startsAt: '2031-05-14T12:30:00.000Z' };
const participant = { mode: 'GUEST' as const, name: 'Riya Patel', phone: '9876543210', payment: 'UPI' };
describe('calendar requests and dates', () => {
  it('uses the club day across UTC midnight and advances across month/year boundaries', () => {
    expect(calendarDate(new Date('2026-10-02T19:00:00Z'))).toBe('2026-10-03');
    expect(dateAfter('2026-12-29', 14)).toBe('2027-01-12');
    expect(slotTime(selection.startsAt, 'Asia/Kolkata')).toMatch(/6:00 pm/);
  });
  it('never includes staff participant or payment fields in a self booking', () => {
    expect(bookingPayload(selection, false, { ...participant, memberId: 'b0000000-0000-4000-8000-000000000001' }, false))
      .toEqual({ ...selection, channel: 'ONLINE' });
  });
  it('validates guest details and requires a selected member for desk bookings', () => {
    expect(() => bookingPayload(selection, true, { ...participant, phone: 'bad' }, false)).toThrow();
    expect(() => bookingPayload(selection, true, { ...participant, mode: 'MEMBER' }, false)).toThrow('Choose a member');
    expect(bookingPayload(selection, true, participant, false)).toEqual({ ...selection, guest: { name: participant.name, phone: participant.phone }, channel: 'DESK', payNow: { method: 'UPI' } });
  });
  it('omits immediate payment and channel from social joins', () => {
    expect(bookingPayload(selection, true, participant, true)).toEqual({ ...selection, guest: { name: participant.name, phone: participant.phone } });
  });
});
