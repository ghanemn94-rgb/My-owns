import { z } from "zod";
import { activeStatus, code, currency, locale, name, timestamp, timeZone, uuid, version } from "./common.ts";

export const organization = z.strictObject({
  id: uuid,
  code,
  nameEn: name,
  nameAr: name,
  defaultTimezone: timeZone,
  defaultCurrency: currency,
  defaultLocale: locale,
  status: activeStatus,
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const organizationCreate = z.strictObject({
  code,
  nameEn: name,
  nameAr: name,
  defaultTimezone: timeZone.optional(),
  defaultCurrency: currency.optional(),
  defaultLocale: locale.optional(),
});
export const organizationUpdate = z
  .strictObject({
    nameEn: name,
    nameAr: name,
    defaultTimezone: timeZone,
    defaultCurrency: currency,
    defaultLocale: locale,
    status: activeStatus,
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "validation.empty_update");

export const businessUnit = z.strictObject({
  id: uuid,
  organizationId: uuid,
  parentBusinessUnitId: uuid.nullable(),
  code,
  nameEn: name,
  nameAr: name,
  status: activeStatus,
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const businessUnitCreate = z.strictObject({
  code,
  nameEn: name,
  nameAr: name,
  parentBusinessUnitId: uuid.optional(),
});
export const businessUnitUpdate = z
  .strictObject({ nameEn: name, nameAr: name, parentBusinessUnitId: uuid.nullable(), status: activeStatus })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "validation.empty_update");

export type Organization = z.infer<typeof organization>;
export type OrganizationCreate = z.infer<typeof organizationCreate>;
export type OrganizationUpdate = z.infer<typeof organizationUpdate>;
export type BusinessUnit = z.infer<typeof businessUnit>;
export type BusinessUnitCreate = z.infer<typeof businessUnitCreate>;
export type BusinessUnitUpdate = z.infer<typeof businessUnitUpdate>;
