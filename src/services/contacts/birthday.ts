// Birthday lookup in device contacts. Optional bonus: reduces questions, never a dependency.
// ⚠ expo-contacts months are 0-indexed (2 = March). Always +1 when building 'MM-DD'.

import * as Contacts from 'expo-contacts';
import { birthdayToMonthDay } from '@/domain/contactBirthday';

export interface ContactBirthday {
  contactId: string;
  name: string;
  monthDay: string; // 'MM-DD'
  year: number | null;
}

export { birthdayToMonthDay };

export async function hasContactsPermission(): Promise<boolean> {
  const { status } = await Contacts.getPermissionsAsync();
  return status === 'granted';
}

export async function requestContactsPermission(): Promise<boolean> {
  const { status } = await Contacts.requestPermissionsAsync();
  return status === 'granted';
}

/** Find a birthday for a first name. Returns null on no permission / no match — flow never breaks. */
export async function lookupBirthday(firstName: string): Promise<ContactBirthday[]> {
  try {
    if (!(await hasContactsPermission())) return [];
    const { data } = await Contacts.getContactsAsync({
      name: firstName,
      fields: [Contacts.Fields.Birthday, Contacts.Fields.FirstName, Contacts.Fields.Name],
      pageSize: 20,
    });
    const out: ContactBirthday[] = [];
    for (const c of data) {
      const conv = birthdayToMonthDay(c.birthday);
      if (!conv || !c.id) continue;
      out.push({ contactId: c.id, name: c.name ?? c.firstName ?? firstName, ...conv });
    }
    return out;
  } catch {
    return [];
  }
}
