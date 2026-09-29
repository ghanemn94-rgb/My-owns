import { z } from 'zod';
import { defineRoute, registerRoutes } from './route';
import { ProjectParams } from './common';

/** WBS/tasks, milestones, deliverables, dependencies, schedule, baselines, change requests, RAID, status updates, my work — contract routes. */
export const planningRoutes = registerRoutes({});

// Keep imports referenced until routes are added.
void z;
void defineRoute;
void ProjectParams;
