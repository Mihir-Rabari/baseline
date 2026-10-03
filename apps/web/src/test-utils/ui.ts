import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { calendarDate, dateAfter } from '@/lib/booking-calendar';
import { formatLongDate } from '@/lib/calendar-grid';

/** Opens a dropdown (Radix select) by its label and chooses an option by its visible name. */
export async function chooseOption(label: string | RegExp, option: string | RegExp) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

/** Opens a date picker by its label and clicks a day, given as `YYYY-MM-DD`, paging months as needed. */
export async function chooseDate(label: string | RegExp, date: string) {
  await userEvent.click(screen.getByLabelText(label));
  const name = formatLongDate(date);
  for (let i = 0; i < 24 && !screen.queryByRole('gridcell', { name }); i += 1) {
    await userEvent.click(screen.getByRole('button', { name: date < calendarDate() ? 'Previous month' : 'Next month' }));
  }
  await userEvent.click(await screen.findByRole('gridcell', { name }));
}

/** Picks a date and a time (24-hour `HH`, minutes `MM`) in a date-time picker. */
export async function chooseDateTime(label: string | RegExp, date: string, hour: string, minute: string) {
  await chooseDate(label, date);
  const group = screen.getByLabelText(label).closest('div')!.parentElement!;
  await userEvent.click(within(group).getByLabelText('Hour'));
  await userEvent.click(await screen.findByRole('option', { name: hour }));
  await userEvent.click(within(group).getByLabelText('Minute'));
  await userEvent.click(await screen.findByRole('option', { name: minute }));
}

/** Today in the club's time zone, and N days later. */
export const today = () => calendarDate();
export const daysFromToday = (days: number) => dateAfter(calendarDate(), days);
