import { z } from 'zod';
import { defineRoute, registerRoutes } from './route';
import { ProjectParams } from './common';

/** Day-1 readiness checks, cutover plans, go/no-go, TSA services — contract routes. */
export const readinessRoutes = registerRoutes({});

// Keep imports referenced until routes are added.
void z;
void defineRoute;
void ProjectParams;
