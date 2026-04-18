import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { registerRoutes } from "./routes";
import { seedConfigDefaults } from "./config-defaults";
import * as fs from "fs";
import * as path from "path";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origin = req.header("origin");

    // Allow any origin: Expo Go connects from arbitrary IPs/networks,
    // and Vercel/hosted deployments may receive requests from any client.
    // Auth is enforced via JWT, so open CORS is safe here.
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
    } else {
      res.header("Access-Control-Allow-Origin", "*");
    }

    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "55mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "55mb" }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const isAuthRoute =
          path.startsWith("/api/auth/login") ||
          path.startsWith("/api/auth/register") ||
          path.startsWith("/api/admin/auth/login");
        const hasToken = capturedJsonResponse && "token" in capturedJsonResponse;
        const safeResponse = isAuthRoute || hasToken
          ? { ...capturedJsonResponse, token: capturedJsonResponse.token ? "[REDACTED]" : undefined }
          : capturedJsonResponse;
        logLine += ` :: ${JSON.stringify(safeResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function serveAdminPanel(app: express.Application) {
  const adminTemplatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "admin.html",
  );

  if (!fs.existsSync(adminTemplatePath)) {
    log("Admin template not found, skipping /admin route");
    return;
  }

  // Serve admin panel at /admin and /admin/*
  app.use("/admin", (req: Request, res: Response) => {
    const adminHtml = fs.readFileSync(adminTemplatePath, "utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.removeHeader("ETag");
    res.status(200).send(adminHtml);
  });

  log("Admin panel served at /admin");
}

function configureExpoAndLanding(app: express.Application) {
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) {
    // In development, proxy all non-API traffic to Metro (port 8081) so the
    // Replit preview pane shows the live Expo web app instead of the landing page.
    log("Dev mode: proxying web traffic → Metro at http://localhost:8081");

    const metroProxy = createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
      ws: true,
      pathFilter: (path) => !path.startsWith("/api") && !path.startsWith("/admin"),
      on: {
        proxyReq: (proxyReq) => {
          proxyReq.removeHeader("origin");
        },
        error: (_err, _req, res) => {
          // Metro may still be bundling — send a friendly retry page
          if (res && "writeHead" in res) {
            (res as Response).status(503).send(
              `<html><head><meta http-equiv="refresh" content="3"></head>
               <body style="font-family:sans-serif;text-align:center;padding:60px">
               <p>Starting Expo bundler… the page will refresh automatically.</p>
               </body></html>`,
            );
          }
        },
      },
    });

    // Handle native Expo manifests (Expo Go on device) before proxying
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      if (req.path.startsWith("/admin")) return next();
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, res);
      }
      return next();
    });

    app.use(metroProxy);
    return;
  }

  // Production: serve the pre-built static Expo bundle + landing page fallback
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    if (req.path !== "/" && req.path !== "/manifest") return next();

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/") {
      return serveLandingPage({ req, res, landingPageTemplate, appName });
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

export async function createApp(): Promise<express.Application> {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  serveAdminPanel(app);
  configureExpoAndLanding(app);

  await seedConfigDefaults();
  await registerRoutes(app);

  setupErrorHandler(app);

  return app;
}

// Only start the HTTP server when running locally (not on Vercel).
// Vercel injects process.env.VERCEL = "1" automatically.
if (!process.env.VERCEL) {
  (async () => {
    const configuredApp = await createApp();
    const { createServer } = await import("node:http");
    const server = createServer(configuredApp);
    const port = parseInt(process.env.PORT || "5000", 10);
    server.listen({ port, host: "0.0.0.0" }, () => {
      log(`express server serving on port ${port}`);
    });
  })();
}
