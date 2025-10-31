import { wagmiConnectors } from "./wagmiConnectors";
import { Chain, createClient, fallback, http, custom } from "viem";
import { hardhat } from "viem/chains";
import { createConfig } from "wagmi";
import scaffoldConfig, { ScaffoldConfig } from "~~/scaffold.config";
import { getAlchemyHttpUrl } from "~~/utils/helper";

const { targetNetworks } = scaffoldConfig;

// 只使用配置的网络 (Sepolia)，不自动添加 mainnet (避免限流)
export const enabledChains = targetNetworks;

export const wagmiConfig = createConfig({
  chains: enabledChains,
  connectors: wagmiConnectors(),
  ssr: true,
  client: ({ chain }) => {
    // 使用配置的 RPC (PublicNode Sepolia)
    const rpcOverrideUrl = (scaffoldConfig.rpcOverrides as ScaffoldConfig["rpcOverrides"])?.[chain.id];
    let transport;
    
    if (rpcOverrideUrl) {
      transport = http(rpcOverrideUrl);
    } else {
      const alchemyHttpUrl = getAlchemyHttpUrl(chain.id);
      transport = alchemyHttpUrl ? http(alchemyHttpUrl) : http();
    }
    
    return createClient({
      chain,
      transport,
      ...(chain.id !== (hardhat as Chain).id ? { pollingInterval: scaffoldConfig.pollingInterval } : {}),
    });
  },
});
