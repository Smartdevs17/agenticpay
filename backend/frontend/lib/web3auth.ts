/**
 * Web3Auth is lazily initialised on first use so that the heavy
 * @web3auth/modal bundle is NOT included in the initial JS payload.
 * Import `getWeb3Auth` instead of the old `web3auth` singleton.
 */

import type { Web3Auth } from "@web3auth/modal";

let _web3auth: Web3Auth | null = null;
let _initPromise: Promise<Web3Auth | null> | null = null;

/**
 * Returns a fully-initialised Web3Auth instance, or null when the
 * client ID env var is missing.  The heavy SDK is dynamically imported
 * so it only lands in the bundle for pages that actually call this.
 */
export async function getWeb3Auth(): Promise<Web3Auth | null> {
  // Return cached instance
  if (_web3auth) return _web3auth;

  // Deduplicate concurrent calls
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID;
    if (!clientId) {
      console.warn(
        "NEXT_PUBLIC_WEB3AUTH_CLIENT_ID is not set. Web3Auth will not work until you add your client ID to .env.local"
      );
      return null;
    }

    // Dynamic import — only fetched when this function is first called
    const [{ Web3Auth }, { CHAIN_NAMESPACES }, { EthereumPrivateKeyProvider }] =
      await Promise.all([
        import("@web3auth/modal"),
        import("@web3auth/base"),
        import("@web3auth/ethereum-provider"),
      ]);

    const chainConfig = {
      chainNamespace: CHAIN_NAMESPACES.EIP155,
      chainId: "0x1",
      rpcTarget: "https://horizon-testnet.stellar.org",
      displayName: "Stellar Testnet",
      blockExplorer: "https://stellar.expert/explorer/testnet",
      ticker: "XLM",
      tickerName: "Stellar Lumens",
    };

    const privateKeyProvider = new EthereumPrivateKeyProvider({
      config: { chainConfig },
    }) as any; // SDK type mismatch between versions — cast is safe here

    _web3auth = new Web3Auth({
      clientId,
      web3AuthNetwork: "testnet",
      chainConfig,
      privateKeyProvider,
      uiConfig: {
        appName: "AgenticPay",
        theme: { primary: "#0052FF" },
        mode: "light",
        loginMethodsOrder: ["google", "twitter", "email_passwordless"],
      },
    } as any); // SDK type mismatch between @web3auth/modal and @web3auth/base versions

    return _web3auth;
  })();

  return _initPromise;
}

/**
 * @deprecated Use `getWeb3Auth()` instead.
 * Kept as a null export so existing static imports don't crash at
 * module-evaluation time — they will just get null and should call
 * getWeb3Auth() before using it.
 */
export const web3auth: Web3Auth | null = null;
