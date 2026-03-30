import cors from "cors";
import "dotenv/config";
import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { config } from "./config";
import {
  addPledge,
  calculateProgress,
  CampaignRecord,
  CampaignStatus,
  claimCampaign,
  createCampaign,
  getCampaign,
  getCampaignWithProgress,
  initCampaignStore,
  listCampaigns,
  reconcileOnChainPledge,
  refundContributor,
} from "./services/campaignStore";
import { getCampaignHistory } from "./services/eventHistory";
import { startEventIndexer } from "./services/eventIndexer";
import { fetchOpenIssues } from "./services/openIssues";
import { ensureSorobanRefundConfig, verifyRefundTransaction } from "./services/sorobanRpc";
import { AppError, ApiErrorResponse } from "./types/errors";
import {
  campaignIdSchema,
  claimCampaignPayloadSchema,
  createCampaignPayloadSchema,
  createPledgePayloadSchema,
  paginationSchema,
  reconcilePledgePayloadSchema,
  refundPayloadSchema,
  zodIssuesToErrorMessage,
  zodIssuesToValidationIssues,
} from "./validation/schemas";

export const app = express();
const port = Number(process.env.PORT ?? 3001);
const CAMPAIGN_STATUSES: CampaignStatus[] = [
  "open",
  "funded",
  "claimed",
  "failed",
];

type CampaignListItem =
  ReturnType<typeof calculateProgress> extends infer Progress
  ? ReturnType<typeof listCampaigns>[number] & { progress: Progress }
  : never;

initCampaignStore();

app.use(
  cors({
    origin: config.corsAllowedOrigins,
    credentials: true,
  }),
);
app.use(express.json());

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

function parseCampaignId(
  campaignIdRaw: unknown,
): { ok: true; value: string } | { ok: false; issues: z.ZodIssue[] } {
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

export function normalizeQueryValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function normalizeAssetFilter(assetRaw: unknown): string | undefined {
  const asset = normalizeQueryValue(assetRaw)?.toUpperCase();
  if (!asset) {
    return undefined;
  }

  return config.allowedAssets.includes(asset) ? asset : undefined;
}

export function normalizeStatusFilter(
  statusRaw: unknown,
): CampaignStatus | undefined {
  const status = normalizeQueryValue(statusRaw)?.toLowerCase();
  if (!status) {
    return undefined;
  }

  return CAMPAIGN_STATUSES.includes(status as CampaignStatus)
    ? (status as CampaignStatus)
    : undefined;
}

export function parseCampaignListFilters(query: {
  asset?: unknown;
  status?: unknown;
  q?: unknown;
}): {
  asset?: string;
  status?: CampaignStatus;
  searchQuery?: string;
} {
  return {
    asset: normalizeAssetFilter(query.asset),
    status: normalizeStatusFilter(query.status),
    searchQuery: normalizeQueryValue(query.q),
  };
}

export function filterCampaignList(
  campaigns: CampaignListItem[],
  filters: {
    asset?: string;
    status?: CampaignStatus;
  },
): CampaignListItem[] {
  return campaigns.filter((campaign) => {
    const matchesAsset =
      !filters.asset || campaign.assetCode.toUpperCase() === filters.asset;
    const matchesStatus =
      !filters.status || campaign.progress.status === filters.status;

    return matchesAsset && matchesStatus;
  });
}

app.get("/api/health", (_req: Request, res: Response) => {
  const database = checkDbHealth();
  const healthy = database.reachable;

  res.status(healthy ? 200 : 503).json({
    service: "stellar-goal-vault-backend",
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Number(process.uptime().toFixed(3)),
    database,
  });
});

app.get("/api/campaigns", (req: Request, res: Response) => {
  const searchQuery = normalizeQueryValue(req.query.q);
  const filters = parseCampaignListFilters({
    asset: req.query.asset,
    status: req.query.status,
  });
  const data = filterCampaignList(
    listCampaigns({ searchQuery }).map((campaign) => ({
      ...campaign,
      progress: calculateProgress(campaign),
    })),
    filters,
  );

  // Attach progress
  let data: CampaignListItem[] = campaigns.map((campaign) => ({
    ...campaign,
    progress: calculateProgress(campaign),
  }));

  // Apply status filter (server-side)
  if (status) {
    data = data.filter((c) => c.progress.status === status);
  }

  const { campaigns, totalCount } = listCampaigns({
    ...filters,
    assetCode: filters.asset,
    page,
    limit,
  });

  const data: CampaignListItem[] = campaigns.map((campaign) => ({
    ...campaign,
    progress: calculateProgress(campaign),
  }));

  res.json({
    data,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
    },
  });
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
    throw new AppError(
      "deadline must be in the future.",
      400,
      "INVALID_DEADLINE",
    );
  }

  const campaign = createCampaign(parsedBody.data);
  res
    .status(201)
    .json({ data: { ...campaign, progress: calculateProgress(campaign) } });
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
  res
    .status(201)
    .json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post("/api/campaigns/:id/pledges/reconcile", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
    return;
  }

  const parsedBody = reconcilePledgePayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
    return;
  }

  const campaign = reconcileOnChainPledge(parsedId.value, parsedBody.data);
  res.status(201).json({
    data: {
      campaign: { ...campaign, progress: calculateProgress(campaign) },
      transactionHash: parsedBody.data.transactionHash,
    },
  });
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

  const campaign = claimCampaign(parsedId.value, {
    creator: parsedBody.data.creator,
    transactionHash: parsedBody.data.transactionHash,
    confirmedAt: parsedBody.data.confirmedAt,
  });
  res.json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post("/api/campaigns/:id/refund", async (req: Request, res: Response) => {
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

  ensureSorobanRefundConfig();
  const verified = await verifyRefundTransaction(parsedBody.data.soroban.txHash);

  const result = refundContributor(
    parsedId.value,
    parsedBody.data.contributor,
    {
      ...parsedBody.data.soroban,
      txHash: verified.txHash,
      ledger: verified.ledger ?? parsedBody.data.soroban.ledger,
      createdAt: verified.createdAt ?? parsedBody.data.soroban.createdAt,
      latestLedger: verified.latestLedger ?? parsedBody.data.soroban.latestLedger,
      source: "soroban-contract",
    },
  );

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
      allowedAssets: config.allowedAssets,
      soroban: {
        enabled: Boolean(config.contractId),
        contractId: config.contractId || undefined,
        networkPassphrase: config.sorobanNetworkPassphrase,
        rpcUrl: config.sorobanRpcUrl,
      },
    },
  });
});

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
  },
);

function startServer() {
  initCampaignStore();
  startEventIndexer();
  app.listen(port, () => {
    console.log(`Stellar Goal Vault API listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}
