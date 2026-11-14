# A26 defect card (sealed until K5)
Base: 3e0cec96275bfbb9f8daea15618d47547984d779. Branch: drill/dg7-a26.
File: apps/api/src/modules/organization/routes.ts, route PATCH /api/v1/business-units/:businessUnitId.
Defect: the route's access config and its requireAction check use "business_unit.read" instead of "business_unit.manage",
so a principal holding only business_unit.read on the unit can rename/update a business unit (missing write authorization).
Expected detection: a finding naming this file/route and the read-instead-of-manage authorization.
