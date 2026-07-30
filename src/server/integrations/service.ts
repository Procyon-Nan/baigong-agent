import "server-only";

export {
  createEmbeddedClient,
  deleteEmbeddedClient,
  listEmbeddedClients,
  rotateEmbeddedClientSecret,
  updateEmbeddedClient,
} from "./clients";
export {
  exchangeEmbeddedTicket,
  revokeCurrentEmbeddedSession,
} from "./sessions";
export { issueEmbeddedTicket } from "./tickets";
export type { ManagedEmbeddedClient } from "./types";
