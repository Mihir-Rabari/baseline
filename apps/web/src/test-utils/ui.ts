import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { calendarDate, dateAfter } from '@/lib/booking-calendar';
import { formatLongDate } from '@/lib/calendar-grid';

/** Opens a dropdown (Radix select) by its label and chooses an option by its visible name. */
export async function chooseOption(label: string | RegExp, option: string | RegExp) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

/** Opens a date picker by its label and clicks a day, given as `YYYY-MM-DD`. */
export async function chooseDate(label: string | RegExp, date: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole('gridcell', { name: formatLongDate(date) }));
}

/** Today in the club's time zone, and N days later. */
export const today = () => calendarDate();
export const daysFromToday = (days: number) => dateAfter(calendarDate(), days);
