import { describe, it, expect } from 'vitest';
import { birthdayToMonthDay } from './contactBirthday';

describe('birthdayToMonthDay (expo-contacts 0-indexed month)', () => {
  it('{ month: 2, day: 14 } is 14 March, not February', () => {
    expect(birthdayToMonthDay({ month: 2, day: 14 })).toEqual({ monthDay: '03-14', year: null });
  });
  it('December is month 11', () => {
    expect(birthdayToMonthDay({ month: 11, day: 24, year: 1990 })).toEqual({ monthDay: '12-24', year: 1990 });
  });
  it('January is month 0', () => {
    expect(birthdayToMonthDay({ month: 0, day: 1 })).toEqual({ monthDay: '01-01', year: null });
  });
  it('missing or invalid → null', () => {
    expect(birthdayToMonthDay(undefined)).toBeNull();
    expect(birthdayToMonthDay({ month: 12, day: 1 })).toBeNull();
    expect(birthdayToMonthDay({ day: 1 })).toBeNull();
  });
});
