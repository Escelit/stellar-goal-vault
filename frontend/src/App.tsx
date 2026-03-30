import { useEffect, useMemo, useState } from "react";
import { CampaignDetailPanel } from "./components/CampaignDetailPanel";
import { CampaignsTable } from "./components/CampaignsTable";
import { CampaignTimeline } from "./components/CampaignTimeline";
import { CreateCampaignForm } from "./components/CreateCampaignForm";
import { IssueBacklog } from "./components/IssueBacklog";
import {
  claimCampaign,
  createCampaign,
  getAppConfig,
  getCampaign,
  getCampaignHistory,
  listCampaigns,
  listOpenIssues,
  reconcilePledge,
  refundCampaign,
} from "./services/api";
import { submitRefundTransaction } from "./services/soroban";
import { ApiError, Campaign, CampaignEvent, OpenIssue } from "./types/campaign";

function round(value: number): number {
  return Number(value.toFixed(2));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getCampaignIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("campaign");
}

function setCampaignIdInUrl(campaignId: string | null): void {
  const url = new URL(window.location.href);
  if (campaignId) {
    url.searchParams.set("campaign", campaignId);
  } else {
    url.searchParams.delete("campaign");
  }
  window.history.replaceState(null, "", url.toString());
}

function toApiError(error: unknown): ApiError {
  if (error instanceof Error) {
    const withMetadata = error as Error & {
      code?: string;
      details?: Array<{ field: string; message: string }>;
      requestId?: string;
    };

    return {
      message: withMetadata.message,
      code: withMetadata.code,
      details: withMetadata.details,
      requestId: withMetadata.requestId,
    };
  }

  return { message: "Unexpected error" };
}

function toOptimisticPledgedCampaign(campaign: Campaign, amount: number): Campaign {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const nextPledgedAmount = round(campaign.pledgedAmount + amount);
  const deadlineReached = nowInSeconds >= campaign.deadline;
  const status =
    campaign.claimedAt !== undefined
      ? "claimed"
      : nextPledgedAmount >= campaign.targetAmount
        ? "funded"
        : deadlineReached
          ? "failed"
          : "open";

  return {
    ...campaign,
    pledgedAmount: nextPledgedAmount,
    progress: {
      ...campaign.progress,
      status,
      percentFunded: round((nextPledgedAmount / campaign.targetAmount) * 100),
      remainingAmount: round(Math.max(0, campaign.targetAmount - nextPledgedAmount)),
      pledgeCount: campaign.progress.pledgeCount + 1,
      canPledge: campaign.claimedAt === undefined && !deadlineReached,
      canClaim:
        campaign.claimedAt === undefined &&
        deadlineReached &&
        nextPledgedAmount >= campaign.targetAmount,
      canRefund:
        campaign.claimedAt === undefined &&
        deadlineReached &&
        nextPledgedAmount < campaign.targetAmount,
    },
  };
}

function App() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [history, setHistory] = useState<CampaignEvent[]>([]);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(false);
  const [isIssuesLoading, setIsIssuesLoading] = useState(false);
  const [isSelectedLoading, setIsSelectedLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  );
  const [selectedCampaignDetails, setSelectedCampaignDetails] =
    useState<Campaign | null>(null);
  const [createError, setCreateError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingPledgeCampaignId, setPendingPledgeCampaignId] = useState<
    string | null
  >(null);
  const [invalidUrlCampaignId, setInvalidUrlCampaignId] = useState<
    string | null
  >(null);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);

  useEffect(() => {
    setCampaignIdInUrl(selectedCampaignId);
  }, [selectedCampaignId]);

  async function refreshCampaigns(nextSelectedId?: string | null) {
    const startedAt = Date.now();
    setIsCampaignsLoading(true);

    try {
      const data = await listCampaigns();
      setCampaigns(data);

      const candidateId =
        nextSelectedId ?? selectedCampaignId ?? (data.length > 0 ? data[0].id : null);
      const exists = candidateId ? data.some((campaign) => campaign.id === candidateId) : false;

      if (nextSelectedId && !exists) {
        setInvalidUrlCampaignId(nextSelectedId);
      } else {
        setInvalidUrlCampaignId(null);
      }

      setSelectedCampaignId(exists ? candidateId : data[0]?.id ?? null);
    } finally {
      const elapsed = Date.now() - startedAt;
      const minMs = 300;
      if (elapsed < minMs) {
        await delay(minMs - elapsed);
      }
      setIsCampaignsLoading(false);
    }
  }

  async function refreshHistory(campaignId: string | null) {
    if (!campaignId) {
      setHistory([]);
      return;
    }

    const data = await getCampaignHistory(campaignId);
    setHistory([...data].reverse());
  }

  async function refreshSelectedCampaign(campaignId: string | null) {
    if (!campaignId) {
      setSelectedCampaignDetails(null);
      return;
    }

    const startedAt = Date.now();
    setIsSelectedLoading(true);
    try {
      const campaign = await getCampaign(campaignId);
      setSelectedCampaignDetails(campaign);
    } finally {
      const elapsed = Date.now() - startedAt;
      const minMs = 200;
      if (elapsed < minMs) {
        await delay(minMs - elapsed);
      }
      setIsSelectedLoading(false);
    }
  }

  // FIX: bootstrap was a nested function with a stray closing brace that
  // made everything below it fall outside the component's scope.
  useEffect(() => {
    async function bootstrap() {
      setInitialLoad(true);
      setActionError(null);

      const urlCampaignId = getCampaignIdFromUrl();

      try {
        setIsIssuesLoading(true);
        const [fetchedIssues] = await Promise.all([
          listOpenIssues(),
          refreshCampaigns(urlCampaignId),
        ]);
        setIssues(fetchedIssues);
      } catch (error) {
        setActionError(toApiError(error));
      } finally {
        setIsIssuesLoading(false);
        setInitialLoad(false);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (initialLoad) {
      return;
    }

    setSelectedCampaignDetails(null);
    void Promise.all([
      refreshHistory(selectedCampaignId).catch((error) =>
        setActionError(toApiError(error)),
      ),
      refreshSelectedCampaign(selectedCampaignId).catch((error) =>
        setActionError(toApiError(error)),
      ),
    ]);
  }, [selectedCampaignId]);

  const selectedCampaign = useMemo(() => {
    const baseCampaign =
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;

    if (!baseCampaign) {
      return null;
    }

    if (selectedCampaignDetails?.id !== baseCampaign.id) {
      return baseCampaign;
    }

    return { ...baseCampaign, pledges: selectedCampaignDetails.pledges };
  }, [campaigns, selectedCampaignDetails, selectedCampaignId]);

  const metrics = useMemo(() => {
    const open = campaigns.filter((c) => c.progress.status === "open").length;
    const funded = campaigns.filter((c) => c.progress.status === "funded").length;
    const pledged = campaigns.reduce((sum, c) => sum + c.pledgedAmount, 0);

    return {
      total: campaigns.length,
      open,
      funded,
      pledged: Number(pledged.toFixed(2)),
    };
  }, [campaigns]);

  async function handleCreate(payload: Parameters<typeof createCampaign>[0]) {
    setCreateError(null);
    setActionError(null);
    setActionMessage(null);

    try {
      const campaign = await createCampaign(payload);
      await refreshCampaigns(campaign.id);
      await Promise.all([
        refreshHistory(campaign.id),
        refreshSelectedCampaign(campaign.id),
      ]);
      setActionMessage(
        `Campaign #${campaign.id} is live and ready for pledges.`,
      );
    } catch (error) {
      setCreateError(toApiError(error));
    }
  }

  async function handlePledge(campaignId: string, contributor: string, amount: number) {
    setActionError(null);
    setActionMessage(null);
    setIsConnectingWallet(true);

    try {
      const wallet = await connectFreighterWallet(appConfig.networkPassphrase);
      setConnectedWallet(wallet.publicKey);
      setActionMessage(`Connected wallet ${wallet.publicKey}.`);
    } catch (error) {
      setActionError(toApiError(error));
    } finally {
      setIsConnectingWallet(false);
    }
  }

  async function handlePledge(campaignId: string, amount: number) {
    if (!appConfig) {
      setActionError({ message: "The app configuration is still loading." });
      return;
    }

    if (!connectedWallet) {
      setActionError({
        message: "Connect Freighter before submitting an on-chain pledge.",
        code: "WALLET_REQUIRED",
      });
      return;
    }

    setActionError(null);
    setActionMessage("Simulating pledge transaction...");
    // Snapshot state so we can rollback on failure while providing
    // a minimum visible pending duration for the UI.
    const pendingStartedAt = Date.now();
    const minimumPendingMs = 300;
    const previousCampaigns = campaigns;
    const previousSelectedDetails = selectedCampaignDetails;
    const previousHistory = history;
    setPendingPledgeCampaignId(campaignId);

    setCampaigns((current) =>
      current.map((campaign) =>
        campaign.id === campaignId ? toOptimisticPledgedCampaign(campaign, amount) : campaign,
      ),
    );

    setSelectedCampaignDetails((current) => {
      if (!current || current.id !== campaignId) {
        return current;
      }

      const optimisticPledge = {
        id: -Date.now(),
        campaignId,
        contributor: connectedWallet,
        amount,
        createdAt: optimisticTimestamp,
      };

      return {
        ...toOptimisticPledgedCampaign(current, amount),
        pledges: [optimisticPledge, ...(current.pledges ?? [])],
      };
    });

    setPendingPledgeCampaignId(campaignId);
    if (selectedCampaignId === campaignId) {
      setHistory((current) => [optimisticEvent, ...current]);
    }

    setActionMessage("Submitting pledge...");

      setActionMessage(
        `Transaction confirmed on-chain. Reconciling local campaign state for ${transactionResult.transactionHash}...`,
      );

      await reconcilePledge(campaignId, {
        contributor: connectedWallet,
        amount,
        transactionHash: transactionResult.transactionHash,
        confirmedAt: transactionResult.confirmedAt,
      });

    try {
      await addPledge(campaignId, { contributor, amount });

      const elapsedMs = Date.now() - pendingStartedAt;
      if (elapsedMs < minimumPendingMs) {
        await delay(minimumPendingMs - elapsedMs);
      }

      await refreshCampaigns(campaignId);
      await Promise.all([
        refreshHistory(campaignId),
        refreshSelectedCampaign(campaignId),
      ]);

      setPendingPledgeCampaignId(null);
      setActionMessage("Pledge recorded in the local goal vault.");
    } catch (error) {
      const elapsedMs = Date.now() - pendingStartedAt;
      if (elapsedMs < minimumPendingMs) {
        await delay(minimumPendingMs - elapsedMs);
      }

      setCampaigns(previousCampaigns);
      setSelectedCampaignDetails(previousSelectedDetails);
      if (selectedCampaignId === campaignId) {
        setHistory(previousHistory);
      }

      setPendingPledgeCampaignId(null);
      setActionMessage(null);
      setActionError(toApiError(error));
    }
  }

  async function handleClaim(campaign: Campaign) {
    if (!appConfig) {
      setActionError({ message: "The app configuration is still loading." });
      return;
    }

    if (!connectedWallet) {
      setActionError({
        message: "Connect Freighter before claiming campaign funds.",
        code: "WALLET_REQUIRED",
      });
      return;
    }

    if (connectedWallet !== campaign.creator) {
      setActionError({
        message:
          "Only the campaign creator can claim funds. Connect the creator wallet.",
        code: "FORBIDDEN",
      });
      return;
    }

    setActionError(null);
    setActionMessage(null);

    try {
      const transactionResult = await submitFreighterClaim({
        campaignId: campaign.id,
        creator: connectedWallet,
        config: appConfig,
      });

      setActionMessage(
        `Claim confirmed on-chain. Reconciling local state for ${transactionResult.transactionHash}...`,
      );

      await claimCampaign(
        campaign.id,
        connectedWallet,
        transactionResult.transactionHash,
        transactionResult.confirmedAt,
      );

      await refreshCampaigns(campaign.id);
      await Promise.all([
        refreshHistory(campaign.id),
        refreshSelectedCampaign(campaign.id),
      ]);
      setActionMessage("Campaign claimed successfully.");
    } catch (error) {
      setActionError(toApiError(error));
    }
  }

  async function handleRefund(campaignId: string, contributor: string) {
    setActionError(null);
    setActionMessage("Preparing Soroban refund transaction...");

    try {
      const sorobanReceipt = await submitRefundTransaction(campaignId, contributor);
      setActionMessage("Soroban refund confirmed. Reconciling local history...");

      await refundCampaign(campaignId, contributor, sorobanReceipt);
      await refreshCampaigns(campaignId);
      await Promise.all([
        refreshHistory(campaignId),
        refreshSelectedCampaign(campaignId),
      ]);

      setActionMessage(
        `Refund confirmed on Soroban and reconciled locally (${sorobanReceipt.txHash.slice(0, 12)}...).`,
      );
    } catch (error) {
      setActionMessage(null);
      setActionError(toApiError(error));
    }
  }

  function handleSelect(campaignId: string) {
    setInvalidUrlCampaignId(null);
    setSelectedCampaignId(campaignId);
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Soroban crowdfunding MVP</p>
        <h1>Stellar Goal Vault</h1>
        <p className="hero-copy">
          Create funding goals, collect pledges, and run contributor refunds through the real Soroban contract path.
        </p>
      </header>

      {invalidUrlCampaignId ? (
        <div className="form-error" style={{ marginBottom: 16 }}>
          <p>Campaign #{invalidUrlCampaignId} was not found. Showing the next available campaign instead.</p>
        </div>
      ) : null}

      <section className="metrics-grid animate-fade-in">
        <article className="metric-card">
          <span>Total campaigns</span>
          <strong>{metrics.total}</strong>
        </article>
        <article className="metric-card">
          <span>Open campaigns</span>
          <strong>{metrics.open}</strong>
        </article>
        <article className="metric-card">
          <span>Funded campaigns</span>
          <strong>{metrics.funded}</strong>
        </article>
        <article className="metric-card">
          <span>Total pledged</span>
          <strong>{metrics.pledged}</strong>
        </article>
      </section>

      <section
        className="layout-grid animate-fade-in"
        style={{ animationDelay: "0.2s" }}
      >
        <CreateCampaignForm
          onCreate={handleCreate}
          apiError={createError}
          allowedAssets={appConfig?.allowedAssets ?? []}
        />
        <CampaignDetailPanel
          campaign={selectedCampaign}
          appConfig={appConfig}
          connectedWallet={connectedWallet}
          isConnectingWallet={isConnectingWallet}
          actionError={actionError}
          actionMessage={actionMessage}
          isPledgePending={pendingPledgeCampaignId === selectedCampaignId}
          isLoading={isSelectedLoading || initialLoad}
          onConnectWallet={handleConnectWallet}
          onPledge={handlePledge}
          onClaim={handleClaim}
          onRefund={handleRefund}
        />
      </section>

      <section className="layout-grid animate-fade-in" style={{ animationDelay: "0.3s" }}>
        <CampaignsTable
          campaigns={campaigns}
          selectedCampaignId={selectedCampaignId}
          onSelect={handleSelect}
          isLoading={isCampaignsLoading}
        />
        <CampaignTimeline
          history={history}
          isLoading={(isSelectedLoading && !!selectedCampaignId) || initialLoad}
        />
      </section>

      <section className="animate-fade-in" style={{ animationDelay: "0.4s" }}>
        <IssueBacklog issues={issues} isLoading={isIssuesLoading} />
      </section>
    </div>
  );
}

export default App;
