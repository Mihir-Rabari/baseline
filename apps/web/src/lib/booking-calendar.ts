import { CreateBookingRequestSchema, JoinSocialRequestSchema, type AvailabilitySlot } from '@packages/validation';

export interface SlotSelection { courtId: string; startsAt: string }
export const canSelectSlot = (slot: AvailabilitySlot) => slot.status === 'FREE' || slot.status === 'SOCIAL_OPEN';

export function calendarDate(now = new Date(), timezone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dateAfter(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function slotTime(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(instant));
}
export function bookingPayload(selection: SlotSelection, staff: boolean, participant: {
  mode: 'MEMBER' | 'GUEST'; memberId?: string; name: string; phone: string; payment: string;
}, social: boolean) {
  if (staff && participant.mode === 'MEMBER' && !participant.memberId) throw new Error('Choose a member before booking.');
  const subject = !staff ? {} : participant.mode === 'MEMBER'
    ? { memberId: participant.memberId } : { guest: { name: participant.name, phone: participant.phone } };
  const base = { ...selection, ...subject };
  if (social) return JoinSocialRequestSchema.parse(base);
  return CreateBookingRequestSchema.parse({ ...base, channel: staff ? 'DESK' : 'ONLINE',
    ...(participant.payment && participant.payment !== 'LATER' ? { payNow: { method: participant.payment } } : {}),
  });
}
