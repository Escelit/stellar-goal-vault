import { useEffect, useMemo, useState } from "react";
import { CampaignDetailPanel } from "./components/CampaignDetailPanel";
import { CampaignsTable } from "./components/CampaignsTable";
import { CampaignTimeline } from "./components/CampaignTimeline";
import { CreateCampaignForm } from "./components/CreateCampaignForm";
import { IssueBacklog } from "./components/IssueBacklog";
import {
  addPledge,
  claimCampaign,
  createCampaign,
  getCampaign,
  getCampaignHistory,
  listCampaigns,
  listOpenIssues,
  refundCampaign,
} from "./services/api";
import { Campaign, CampaignEvent, OpenIssue, ApiError } from "./types/campaign";

function round(value: number): number {
  return Number(value.toFixed(2));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(false);
  const [isSelectedLoading, setIsSelectedLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaignDetails, setSelectedCampaignDetails] = useState<Campaign | null>(null);
  const [createError, setCreateError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingPledgeCampaignId, setPendingPledgeCampaignId] = useState<string | null>(null);
  const [invalidUrlCampaignId, setInvalidUrlCampaignId] = useState<string | null>(null);

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
      const exists = data.some((campaign) => campaign.id === candidateId);
      setSelectedCampaignId(exists ? candidateId : data[0]?.id ?? null);
    } finally {
      const elapsed = Date.now() - startedAt;
      const minMs = 300;
      if (elapsed < minMs) await delay(minMs - elapsed);
      setIsCampaignsLoading(false);
    }
  }

  async function refreshHistory(campaignId: string | null) {
    if (!campaignId) {
      setHistory([]);
      return;
    }
    try {
      const data = await getCampaignHistory(campaignId);
      setHistory(data);
    } catch {
      setHistory([]);
    }
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
      if (elapsed < minMs) await delay(minMs - elapsed);
      setIsSelectedLoading(false);
    }
  }

  // FIX: bootstrap was a nested function with a stray closing brace that
  // made everything below it fall outside the component's scope.
  useEffect(() => {
    async function bootstrap() {
      try {
        const urlCampaignId = getCampaignIdFromUrl();
        const [campaignData, issueData] = await Promise.all([
          listCampaigns(),
          listOpenIssues(),
        ]);
        setIssues(issueData);
        setCampaigns(campaignData);

        if (urlCampaignId) {
          const exists = campaignData.some((c) => c.id === urlCampaignId);
          if (exists) {
            setSelectedCampaignId(urlCampaignId);
          } else {
            setInvalidUrlCampaignId(urlCampaignId);
            setSelectedCampaignId(campaignData[0]?.id ?? null);
          }
        } else {
          setSelectedCampaignId(campaignData[0]?.id ?? null);
        }
      } finally {
        setInitialLoad(false);
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    setSelectedCampaignDetails(null);
    void Promise.all([
      refreshHistory(selectedCampaignId),
      refreshSelectedCampaign(selectedCampaignId),
    ]);
  }, [selectedCampaignId]);

  // ── derived state ────────────────────────────────────────────────────────

  const selectedCampaign = useMemo(() => {
    const baseCampaign =
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
    if (!baseCampaign) return null;
    if (selectedCampaignDetails?.id !== baseCampaign.id) return baseCampaign;
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

  // ── action handlers ──────────────────────────────────────────────────────

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
      setActionMessage(`Campaign #${campaign.id} is live and ready for pledges.`);
    } catch (error) {
      setCreateError(error as ApiError);
    }
  }

  async function handlePledge(
    campaignId: string,
    contributor: string,
    amount: number,
  ) {
    setActionError(null);
    setActionMessage(null);

    const previousCampaigns = campaigns;
    const previousHistory = history;
    const previousSelectedDetails = selectedCampaignDetails;
    const optimisticTimestamp = Math.floor(Date.now() / 1000);
    const optimisticEvent: CampaignEvent = {
      id: -Date.now(),
      campaignId,
      eventType: "pledged",
      timestamp: optimisticTimestamp,
      actor: contributor,
      amount,
      metadata: { pending: true },
    };

    setCampaigns((current) =>
      current.map((c) =>
        c.id === campaignId ? toOptimisticPledgedCampaign(c, amount) : c,
      ),
    );
    setSelectedCampaignDetails((current) => {
      if (!current || current.id !== campaignId) return current;
      const optimisticPledge = {
        id: -Date.now(),
        campaignId,
        contributor,
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

    const pendingStartedAt = Date.now();
    const minimumPendingMs = 800;

    try {
      await addPledge(campaignId, { contributor, amount });
      const elapsedMs = Date.now() - pendingStartedAt;
      if (elapsedMs < minimumPendingMs) await delay(minimumPendingMs - elapsedMs);
      await refreshCampaigns(campaignId);
      await Promise.all([
        refreshHistory(campaignId),
        refreshSelectedCampaign(campaignId),
      ]);
      setPendingPledgeCampaignId(null);
      setActionMessage("Pledge recorded in the local goal vault.");
    } catch (error) {
      const elapsedMs = Date.now() - pendingStartedAt;
      if (elapsedMs < minimumPendingMs) await delay(minimumPendingMs - elapsedMs);
      setCampaigns(previousCampaigns);
      setSelectedCampaignDetails(previousSelectedDetails);
      await refreshSelectedCampaign(campaignId);
      if (selectedCampaignId === campaignId) setHistory(previousHistory);
      setPendingPledgeCampaignId(null);
      setActionMessage(null);
      setActionError(error as ApiError);
    }
  }

  async function handleClaim(campaign: Campaign) {
    setActionError(null);
    setActionMessage(null);
    try {
      await claimCampaign(campaign.id, campaign.creator);
      await refreshCampaigns(campaign.id);
      await Promise.all([
        refreshHistory(campaign.id),
        refreshSelectedCampaign(campaign.id),
      ]);
      setActionMessage("Campaign claimed successfully.");
    } catch (error) {
      setActionError(error as ApiError);
    }
  }

  async function handleRefund(campaignId: string, contributor: string) {
    setActionError(null);
    setActionMessage(null);
    try {
      await refundCampaign(campaignId, contributor);
      await refreshCampaigns(campaignId);
      await Promise.all([
        refreshHistory(campaignId),
        refreshSelectedCampaign(campaignId),
      ]);
      setActionMessage("Refund recorded for the selected contributor.");
    } catch (error) {
      setActionError(error as ApiError);
    }
  }

  function handleSelect(campaignId: string) {
    setInvalidUrlCampaignId(null);
    setSelectedCampaignId(campaignId);
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Soroban crowdfunding MVP</p>
        <h1>Stellar Goal Vault</h1>
        <p className="hero-copy">
          Create funding goals, collect pledges, and model claim or refund flows
          before wiring the full Soroban transaction path.
        </p>
      </header>

      {/* FIX: opening <section> tag was missing for the metrics grid */}
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

      <section className="layout-grid animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <CreateCampaignForm onCreate={handleCreate} apiError={createError} />
        {/* FIX: removed actionError prop — it doesn't exist on CampaignDetailPanelProps */}
        <CampaignDetailPanel
          campaign={selectedCampaign}
          actionMessage={actionMessage}
          isPledgePending={pendingPledgeCampaignId === selectedCampaignId}
          isLoading={isSelectedLoading || initialLoad}
          onPledge={handlePledge}
          onClaim={handleClaim}
          onRefund={handleRefund}
        />
      </section>

      {/* FIX: stray closing </section> removed; replaced with proper table/timeline sections */}
      <section className="animate-fade-in" style={{ animationDelay: "0.4s" }}>
        <CampaignsTable
          campaigns={campaigns}
          selectedCampaignId={selectedCampaignId}
          isLoading={isCampaignsLoading || initialLoad}
          invalidUrlCampaignId={invalidUrlCampaignId}
          onSelect={handleSelect}
        />
      </section>

      <section className="animate-fade-in" style={{ animationDelay: "0.6s" }}>
        <CampaignTimeline
          history={history}
        />
      </section>

      <section className="animate-fade-in" style={{ animationDelay: "0.8s" }}>
        <IssueBacklog issues={issues} />
      </section>
    </div>
  );
}

export default App;