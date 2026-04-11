import type { Express } from "express";
import { createServer, type Server } from "node:http";

import healthRouter from "./routes/health";
import authRouter from "./routes/auth";
import backofficeAuthRouter from "./routes/backoffice-auth";
import backofficeViewsRouter from "./routes/backoffice-views";
import backofficeUsersRouter from "./routes/backoffice-users";
import placesRouter from "./routes/places";
import reviewsRouter from "./routes/reviews";
import claimsRouter from "./routes/claims";
import storiesRouter from "./routes/stories";
import filtersRouter from "./routes/filters";
import kidscoreRouter from "./routes/kidscore";
import citiesRouter from "./routes/cities";
import pipelineRouter from "./routes/pipeline";
import pipelineAdminRouter from "./routes/pipeline-admin";
import aiProvidersRouter from "./routes/ai-providers";
import curationRouter from "./routes/curation";
import publishedRouter from "./routes/published";
import sponsorshipRouter from "./routes/sponsorship";
import feedbackRouter from "./routes/feedback";
import partnerRouter from "./routes/partner";

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(healthRouter);
  app.use(authRouter);
  app.use(backofficeAuthRouter);
  app.use(backofficeViewsRouter);
  app.use(backofficeUsersRouter);
  app.use(placesRouter);
  app.use(reviewsRouter);
  app.use(claimsRouter);
  app.use(storiesRouter);
  app.use(filtersRouter);
  app.use(kidscoreRouter);
  app.use(citiesRouter);
  app.use(pipelineRouter);
  app.use(pipelineAdminRouter);
  app.use(aiProvidersRouter);
  app.use(curationRouter);
  app.use(publishedRouter);
  app.use(sponsorshipRouter);
  app.use(feedbackRouter);
  app.use(partnerRouter);

  return createServer(app);
}
