import { z } from 'zod';
import { defineRoute, registerRoutes } from './route';
import { ProjectParams } from './common';

/** Committees, authority matrix, meetings, agenda, decisions, votes, actions, escalations — contract routes. */
export const governanceRoutes = registerRoutes({});

// Keep imports referenced until routes are added.
void z;
void defineRoute;
void ProjectParams;
