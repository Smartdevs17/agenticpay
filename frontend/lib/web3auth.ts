import { Web3Auth, type IWeb3AuthModal } from "@web3auth/modal";
import { CHAIN_NAMESPACES } from "@web3auth/base";
import { EthereumPrivateKeyProvider } from "@web3auth/ethereum-provider";

const chainConfig = {
  chainNamespace: CHAIN_NAMESPACES.EIP155,
  chainId: "0x1", // Placeholder — Stellar integration uses Freighter wallet
  rpcTarget: "https://horizon-testnet.stellar.org",
  displayName: "Stellar Testnet",
  blockExplorer: "https://stellar.expert/explorer/testnet",
  ticker: "XLM",
  tickerName: "Stellar Lumens",
};

const privateKeyProvider = new EthereumPrivateKeyProvider({
  config: { chainConfig },
});

// Get client ID from environment or use a placeholder for development
const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID;

if (!clientId) {
  console.warn(
    'NEXT_PUBLIC_WEB3AUTH_CLIENT_ID is not set. Web3Auth will not work until you add your client ID to .env.local'
  );
}

// Only initialize Web3Auth if client ID is provided
export const web3auth: IWeb3AuthModal | null = clientId
  ? new Web3Auth({
      clientId,
      web3AuthNetwork: "testnet",
      chainConfig,
      privateKeyProvider,
      uiConfig: {
        appName: "AgenticPay",
        theme: {
          primary: "#0052FF",
        },
        mode: "light",
        loginMethodsOrder: ["google", "twitter", "email_passwordless"],
      },
    })
  : null;
