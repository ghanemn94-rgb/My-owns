import { z } from 'zod';
import { defineRoute, registerRoutes } from './route';
import { ProjectParams } from './common';

/** Partners, rooms & grants, deal scenarios, negotiation, DD, findings, signing/closing, CPs, post-close — contract routes. */
export const jvRoutes = registerRoutes({});

// Keep imports referenced until routes are added.
void z;
void defineRoute;
void ProjectParams;
