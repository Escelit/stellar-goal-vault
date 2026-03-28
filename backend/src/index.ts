import cors from "cors";
import "dotenv/config";
import express, { Request, Response } from "express";
import { config } from "./config";
import { z } from "zod";
import {
  addPledge,
  calculateProgress,
  claimCampaign,
  createCampaign,
  getCampaign,
  getCampaignWithProgress,
  initCampaignStore,
  listCampaigns,
  refundContributor,
} from "./services/campaignStore";
import { startEventIndexer } from "./services/eventIndexer";
import { getCampaignHistory } from "./services/eventHistory";
import { fetchOpenIssues } from "./services/openIssues";
import {
  campaignIdSchema,
  claimCampaignPayloadSchema,
  createCampaignPayloadSchema,
  createPledgePayloadSchema,
  refundPayloadSchema,
  zodIssuesToErrorMessage,
  zodIssuesToValidationIssues,
} from "./validation/schemas";
import { AppError, ApiErrorResponse } from "./types/errors";
import { randomUUID } from "crypto";

export const app = express();
const port = Number(process.env.PORT ?? 3001);

// Initialize DB and start indexer
try {
  initCampaignStore();
  startEventIndexer();
} catch (error) {
  console.error("Failed to initialize campaign store or event indexer:", error);
  process.exit(1);
}

app.use(cors());
app.use(express.json());

// Request ID middleware
app.use((req: Request & { requestId?: string }, _res: Response, next: express.NextFunction) => {
  req.requestId = randomUUID();
  next();
});

function sendValidationError(issues: z.ZodIssue[]) {
  throw new AppError(
    zodIssuesToErrorMessage(issues),
    400,
    "VALIDATION_ERROR",
    zodIssuesToValidationIssues(issues),
  );
}

function parseCampaignId(campaignIdRaw: unknown):
  | { ok: true; value: string }
  | { ok: false; issues: z.ZodIssue[] } {
  if (typeof campaignIdRaw !== "string") {
    return {
      ok: false,
      issues: [
        {
          code: "custom",
          message: "Campaign ID must be a string.",
          path: ["id"],
        },
      ],
    };
  }

  const parsed = campaignIdSchema.safeParse(campaignIdRaw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues };
  }

  return { ok: true, value: parsed.data };
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    service: "stellar-goal-vault-backend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/campaigns", (_req: Request, res: Response) => {
  const data = listCampaigns().map((campaign) => ({
    ...campaign,
    progress: calculateProgress(campaign),
  }));

  res.json({ data });
});

app.get("/api/campaigns/:id", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
    return;
  }

  const campaign = getCampaignWithProgress(parsedId.value);
  if (!campaign) {
    throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  }

  res.json({ data: campaign });
});

app.post("/api/campaigns", (req: Request, res: Response) => {
  const parsedBody = createCampaignPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
    return;
  }

  if (parsedBody.data.deadline <= Math.floor(Date.now() / 1000)) {
    throw new AppError("deadline must be in the future.", 400, "INVALID_DEADLINE");
  }

  const campaign = createCampaign(parsedBody.data);
  res.status(201).json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post("/api/campaigns/:id/pledges", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
    return;
  }

  const parsedBody = createPledgePayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
    return;
  }

  const campaign = addPledge(parsedId.value, parsedBody.data);
  res.status(201).json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post("/api/campaigns/:id/claim", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
    return;
  }

  const parsedBody = claimCampaignPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
    return;
  }

  const campaign = claimCampaign(parsedId.value, parsedBody.data.creator);
  res.json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post("/api/campaigns/:id/refund", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
    return;
  }

  const parsedBody = refundPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
    return;
  }

  const result = refundContributor(parsedId.value, parsedBody.data.contributor);
  res.json({
    data: {
      ...result.campaign,
      progress: calculateProgress(result.campaign),
      refundedAmount: result.refundedAmount,
    },
  });
});

app.get("/api/campaigns/:id/history", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
    return;
  }

  const campaign = getCampaign(parsedId.value);
  if (!campaign) {
    throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  }

  res.json({ data: getCampaignHistory(parsedId.value) });
});

app.get("/api/open-issues", async (_req: Request, res: Response) => {
  const data = await fetchOpenIssues();
  res.json({ data });
});

app.get("/api/config", (_req: Request, res: Response) => {
  res.json({
    data: {
    },
  });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, _next: express.NextFunction) => {
  const statusCode = err instanceof AppError ? err.statusCode : (err.statusCode ?? 500);
  const code = err instanceof AppError ? err.code : (err.code ?? "INTERNAL_SERVER_ERROR");
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message: err.message || "An unexpected error occurred",
      requestId: (req as any).requestId,
    },
  };

  if (err instanceof AppError && err.details) {
    response.error.details = err.details;
  } else if (err.details) {
    response.error.details = err.details;
  }

  res.status(statusCode).json(response);
});

function startServer() {
  initCampaignStore();
  app.listen(port, () => {
    console.log(`Stellar Goal Vault API listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}
