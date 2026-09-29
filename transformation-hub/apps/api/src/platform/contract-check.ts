import type { INestApplication } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROUTES } from '@hub/contracts';
import { ROUTE_META } from './contracts';

/**
 * Boot-time contract check (ADR-0007): every controller handler (except health probes) must be bound to a registered
 * contract route, and every registered route must be implemented. Fails fast in dev/test.
 */
export function checkContracts(app: INestApplication): { implemented: number; missing: string[]; unbound: string[] } {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const implemented = new Set<string>();
  const unbound: string[] = [];
  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as object | undefined;
    if (!instance) continue;
    const proto = Object.getPrototypeOf(instance);
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      const def = reflector.get(ROUTE_META, handler);
      const isRoute = Reflect.getMetadata(PATH_METADATA, handler) !== undefined;
      if (def) implemented.add(def.id);
      else if (isRoute && wrapper.name !== 'HealthController') unbound.push(`${wrapper.name}.${name}`);
    }
  }
  const missing = Object.keys(ROUTES).filter((id) => !implemented.has(id));
  return { implemented: implemented.size, missing, unbound };
}
