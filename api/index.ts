import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/index";

// createApp() is awaited once per cold start; subsequent requests reuse the same instance.
const appReady = createApp();

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const app = await appReady;
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
