import type { Campaign } from "../types/campaign";

/**
 * Returns sorted, deduplicated assetCode values from the given campaigns.
 */
export function getDistinctAssetCodes(campaigns: Campaign[]): string[] {
  return [...new Set(campaigns.map((c) => c.assetCode))].sort();
}

/**
 * Pure function that applies both asset code and status predicates to a campaign list.
 * Pass "" as assetCode or status to skip that filter.
 */
export function applyFilters(
  campaigns: Campaign[],
  assetCode: string,
  status: string,
): Campaign[] {
  return campaigns.filter((c) => {
    const matchesAsset = assetCode === "" || c.assetCode === assetCode;
    const matchesStatus = status === "" || c.progress.status === status;
    return matchesAsset && matchesStatus;
  });
}
