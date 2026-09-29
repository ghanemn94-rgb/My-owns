import { z } from 'zod';
import { defineRoute, registerRoutes } from './route';
import { ProjectParams } from './common';

/** Business gates, criteria assessments, waivers, status dimensions — contract routes. */
export const gatesRoutes = registerRoutes({});

// Keep imports referenced until routes are added.
void z;
void defineRoute;
void ProjectParams;
