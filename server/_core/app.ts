import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { Express } from "express";
import { registerOAuthRoutes } from "./oauth";
import { registerGHLOAuthRoutes } from "../ghl-oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./vite";

export function createApp(options?: { serveClient?: boolean }): Express {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerGHLOAuthRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (options?.serveClient) {
    serveStatic(app);
  }

  return app;
}
