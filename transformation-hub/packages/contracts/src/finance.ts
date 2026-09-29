import { z } from 'zod';
import { defineRoute, registerRoutes } from './route';
import { ProjectParams } from './common';

/** Financial snapshots, budget, business plan / valuation references, benefits — contract routes. */
export const financeRoutes = registerRoutes({});

// Keep imports referenced until routes are added.
void z;
void defineRoute;
void ProjectParams;
