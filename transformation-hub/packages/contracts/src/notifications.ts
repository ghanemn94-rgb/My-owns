import { z } from 'zod';
import { defineRoute, registerRoutes } from './route';
import { ProjectParams } from './common';

/** In-app notifications, delivery ledger — contract routes. */
export const notificationsRoutes = registerRoutes({});

// Keep imports referenced until routes are added.
void z;
void defineRoute;
void ProjectParams;
