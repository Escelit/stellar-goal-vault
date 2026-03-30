import "dotenv/config";

const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const parseOrigins = (originsStr: string): string[] => {
  return originsStr
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
};

const parseInteger = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const config = {
  port: Number(process.env.PORT ?? 3001),
  allowedAssets: (process.env.ALLOWED_ASSETS ?? "USDC,XLM")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
  corsAllowedOrigins: parseOrigins(
    process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:5173",
  ),
  sorobanRpcUrl: process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org:443",
  contractId: process.env.CONTRACT_ID ?? "",
  sorobanNetworkPassphrase:
    process.env.SOROBAN_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
};

export const walletIntegrationReady = Boolean(config.contractId && config.sorobanRpcUrl);
