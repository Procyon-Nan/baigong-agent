import { eveChannel } from "eve/channels/eve";
import { localDev } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // This verifier is ignored outside local development, so production fails closed
    // until the BFF service-token verifier is added with the conversation chain.
    localDev(),
  ],
});
