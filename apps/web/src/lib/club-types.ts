// TODO: replace with @packages/validation types when M-04 publishes them.
export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  monthlyFeePaise: number;
  courtDiscountPct: number;
  shopDiscountPct: number;
  barDiscountPct: number;
  maxBookingsPerDay: number;
  bookingHorizonDays: number;
  minAge: number | null;
  maxAge: number | null;
  isActive: boolean;
}

export interface PublicClub {
  name: string;
  tagline: string;
  phone: string;
  address: string;
  hours: { open: string; close: string };
  timezone: string;
  courtTypes: {
    id: string;
    code: string;
    name: string;
    baseRatePaise: number;
    trialFeePaise: number;
    courtCount: number;
  }[];
  socialPlay: { weekday: number; startsTime: string; endsTime: string };
}
