// The mined company dictionary — ~1,800 major public + private companies across North America and
// Europe, authored from index constituents (S&P 500, FTSE 100/250, DAX/CAC/AEX/SMI/Nordics/IBEX/
// FTSE MIB), the major private companies, and the full professional-services landscape (Big 4, MBB,
// the accountancy networks, law, search, GBS). Each carries aliases (tickers, short names, legal-
// suffix variants, brands, former names) so a buyer's raw LinkedIn "Company" field matches.
//
// Slices live in sibling files (one per research pass). This file just concatenates them; dedupe +
// the alias index happen in ../classify.ts when the lookup tables are built.

import type { CompanyEntry } from "../../config/markets";
import { COMPANIES as usFinancials } from "./us-financials";
import { COMPANIES as usTechTelecom } from "./us-tech-telecom";
import { COMPANIES as healthcareGlobal } from "./healthcare-global";
import { COMPANIES as energyIndustrials } from "./energy-industrials-global";
import { COMPANIES as consumerRetail } from "./consumer-retail-global";
import { COMPANIES as ftseUk } from "./ftse-uk";
import { COMPANIES as europeContinental } from "./europe-continental";
import { COMPANIES as privateProServices } from "./private-and-proservices";
import { COMPANIES as publicSectorGlobal } from "./public-sector-global";
import { COMPANIES as midcapsGlobal } from "./midcaps-global";
import { COMPANIES as proservicesRealEstate } from "./proservices-realestate";
import { COMPANIES as globalMajors } from "./global-majors";
import { COMPANIES as privateScaleups } from "./private-scaleups";
import { COMPANIES as globalExpansion } from "./global-expansion";
import { COMPANIES as researchFirms } from "./research-firms";
import { COMPANIES as auditOverrides } from "./audit-overrides";

export const SLICE_COMPANIES: CompanyEntry[] = [
  ...auditOverrides, // audit corrections first so they win any same-name collision
  ...usFinancials,
  ...usTechTelecom,
  ...healthcareGlobal,
  ...energyIndustrials,
  ...consumerRetail,
  ...ftseUk,
  ...europeContinental,
  ...privateProServices,
  ...publicSectorGlobal,
  ...midcapsGlobal,
  ...proservicesRealEstate,
  ...globalMajors,
  ...privateScaleups,
  ...globalExpansion,
  ...researchFirms,
];
