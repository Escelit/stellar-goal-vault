import { useState, useMemo } from "react";
import { LayoutGrid } from "lucide-react";
import { Campaign } from "../types/campaign";
import { EmptyState } from "./EmptyState";
import { AssetFilterDropdown } from "./AssetFilterDropdown";

interface CampaignsTableProps {
  campaigns: Campaign[];
  selectedCampaignId: string | null;
  onSelect: (campaignId: string) => void;
  isLoading?: boolean;
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

export function CampaignsTable({
  campaigns,
  selectedCampaignId,
  onSelect,
  isLoading,
}: CampaignsTableProps) {
  const [selectedAssetCode, setSelectedAssetCode] = useState<string>("");

  const isEmpty = campaigns.length === 0;

  const distinctAssetCodes = useMemo(() => {
    const codes = new Set(campaigns.map((c) => c.assetCode));
    return Array.from(codes).sort();
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    if (!selectedAssetCode || selectedAssetCode === "") return campaigns;
    return campaigns.filter((c) => c.assetCode === selectedAssetCode);
  }, [campaigns, selectedAssetCode]);

  if (campaigns.length === 0) {
    return (
      <EmptyState
        variant="card"
        icon={LayoutGrid}
        title="Campaign board"
        message="No campaigns yet. Create the first vault to make this board active."
      />
    );
  }

  return (
    <section className="card">
      <div className="section-heading">
        <h2>Campaign board</h2>
        {isEmpty ? (
          <p className="muted">
            No campaigns yet. Create the first vault to make this board active.
          </p>
        ) : (
          <p className="muted">
            Monitor progress and open one campaign at a time in the action
            panel.
          </p>
        )}
      </div>

      <div className="board-controls">
        <AssetFilterDropdown
          options={distinctAssetCodes}
          value={selectedAssetCode}
          onChange={setSelectedAssetCode}
          disabled={isEmpty}
        />
      </div>

      {!isEmpty && filteredCampaigns.length === 0 ? (
        <p className="muted">No campaigns match the current filters.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Creator</th>
                <th>Funding</th>
                <th>Status</th>
                <th>Deadline</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <div className="stacked">
                      <strong>{campaign.title}</strong>
                      <span className="muted">#{campaign.id}</span>
                    </div>
                  </td>
                  <td className="mono">{campaign.creator.slice(0, 8)}...</td>
                  <td>
                    <div className="progress-copy">
                      {campaign.pledgedAmount} / {campaign.targetAmount}{" "}
                      {campaign.assetCode}
                    </div>
                    <div className="progress-bar" aria-hidden>
                      <div
                        style={{
                          width: `${Math.min(campaign.progress.percentFunded, 100)}%`,
                        }}
                      />
                    </div>
                    <span className="muted">
                      {campaign.progress.percentFunded}% funded
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${campaign.progress.status}`}>
                      {campaign.progress.status}
                    </span>
                  </td>
                  <td className="stacked">
                    <span>{formatTimestamp(campaign.deadline)}</span>
                    <span className="muted">
                      {campaign.progress.hoursLeft}h left
                    </span>
                  </td>
                  <td>
                    <button
                      className={
                        selectedCampaignId === campaign.id
                          ? "btn-secondary"
                          : "btn-ghost"
                      }
                      type="button"
                      onClick={() => onSelect(campaign.id)}
                    >
                      {selectedCampaignId === campaign.id ? "Selected" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
