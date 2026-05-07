import type { EntityId, IsoDateTime } from "./entities";

/** Creates a stable random identifier for persisted local records. */
export const createEntityId = (): EntityId => {
  return crypto.randomUUID();
};

/** Creates an ISO 8601 timestamp for persisted record dates. */
export const createIsoDateTime = (): IsoDateTime => {
  return new Date().toISOString();
};
