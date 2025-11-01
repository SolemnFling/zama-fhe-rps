"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useFhevm } from "fhevm-sdk/react";
import { formatEther, parseEther } from "viem";
import { type MatchMode, type Move, usePrivateRPSWagmi } from "~~/hooks/private-rps/usePrivateRPSWagmi";
import { useWagmiEthers } from "~~/hooks/wagmi/useWagmiEthers";
import scaffoldConfig from "~~/scaffold.config";
import { ethers } from "ethers";
import { type Language, translations, getBrowserLanguage } from "~~/utils/i18n";

// 历史记录卡片组件（侧边栏用）
function CompactHistoryCard({
  matchId,
  contractAddress,
  myAddress,
  claim,
  expireCreated,
  isProcessing,
  lang,
}: {
  matchId: string;
  contractAddress: string;
  myAddress: string;
  claim: (matchId: string) => Promise<void>;
  expireCreated: (matchId: string) => Promise<void>;
  isProcessing: boolean;
  lang: Language;
}) {
  const t = translations[lang];
  const [matchData, setMatchData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMatchData = async () => {
      try {
        let provider: any;
        try {
          const browserProvider = new ethers.BrowserProvider((window as any).ethereum);
          provider = browserProvider;
        } catch {
          const rpc = (scaffoldConfig.rpcOverrides as any)?.[11155111];
          provider = new ethers.JsonRpcProvider(rpc);
        }

        const abi = [
          "function getStatus(bytes32) view returns (uint8,address,address,uint256,uint64,uint8,address)",
        ];
        const contract = new ethers.Contract(contractAddress, abi, provider);
        const status = await contract.getStatus(matchId);
        setMatchData({
          state: Number(status[0]),
          playerA: status[1],
          playerB: status[2],
          stake: status[3],
          deadline: Number(status[4]),
          mode: status[5],
          winner: status[6],
        });
      } catch (e) {
        console.error("获取对局数据失败:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchMatchData();
  }, [matchId, contractAddress]);

  if (loading) return <div className="p-3 bg-yellow-100 rounded border-2 border-yellow-300 text-black/50 text-xs font-semibold">...</div>;
  if (!matchData) return null;

  const stateNames = [t.created, t.joined, "Locked", t.resolved, t.expired];
  const isExpired = matchData.state === 4;
  const isCreated = matchData.state === 0;
  const isResolved = matchData.state === 3;
  const isMyMatch = matchData.playerA.toLowerCase() === myAddress.toLowerCase() ||
                     matchData.playerB.toLowerCase() === myAddress.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const isDeadlinePassed = matchData.deadline < now;
  const canClaim = isResolved && matchData.winner.toLowerCase() === myAddress.toLowerCase();
  // 只有真的过期了才能标记过期
  const canExpire = isCreated && isDeadlinePassed && matchData.playerA.toLowerCase() === myAddress.toLowerCase();

  // 计算输赢状态 - 如果已经过期或者deadline已过，优先显示过期状态
  const actuallyExpired = isExpired || (isCreated && isDeadlinePassed);
  const isWinner = !actuallyExpired && isResolved && matchData.winner.toLowerCase() === myAddress.toLowerCase();
  const isLoser = !actuallyExpired && isResolved && isMyMatch && matchData.winner !== ethers.ZeroAddress && !isWinner;
  const isDraw = !actuallyExpired && isResolved && matchData.winner === ethers.ZeroAddress;

  // 格式化相对时间（显示离deadline还有多久，或者过去多久）
  const formatTimeRemaining = (deadline: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = deadline - now;
    
    if (diff > 0) {
      // 未过期：显示剩余时间
      let time = "";
      if (diff < 60) time = `${diff}${t.seconds}`;
      else if (diff < 3600) time = `${Math.floor(diff / 60)}${t.minutes}`;
      else if (diff < 86400) time = `${Math.floor(diff / 3600)}${t.hours}`;
      else time = `${Math.floor(diff / 86400)}${t.days}`;
      return t.expiresIn(time);
    } else {
      // 已过期：显示过期多久
      const absDiff = Math.abs(diff);
      let time = "";
      if (absDiff < 60) time = `${absDiff}${t.seconds}`;
      else if (absDiff < 3600) time = `${Math.floor(absDiff / 60)}${t.minutes}`;
      else if (absDiff < 86400) time = `${Math.floor(absDiff / 3600)}${t.hours}`;
      else time = `${Math.floor(absDiff / 86400)}${t.days}`;
      return t.expiredAgo(time);
    }
  };

  return (
    <div className="p-3 bg-yellow-50 rounded-lg border-2 border-yellow-300 space-y-2 hover:border-yellow-400 hover:shadow-md transition-all">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-black/60 font-bold">
          {matchId.slice(0, 8)}...
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border-2 ${
          isExpired ? "bg-red-100 text-red-700 border-red-400" :
          isResolved ? "bg-green-100 text-green-700 border-green-400" :
          "bg-yellow-200 text-black border-yellow-400"
        }`}>
          {stateNames[matchData.state]}
        </span>
      </div>
      
      <div className="text-[10px] text-black/70 space-y-1 font-semibold">
        <div className="flex items-center justify-between">
          <span>💰 {formatEther(matchData.stake)} ETH</span>
          <span className={`text-xs font-bold ${isDeadlinePassed ? 'text-red-500' : 'text-blue-500'}`}>
            {formatTimeRemaining(matchData.deadline)}
          </span>
        </div>
        
        {/* 输赢状态 - 过期优先显示 */}
        {actuallyExpired ? (
          <div className="text-red-600 font-black flex items-center gap-1">
            ⌛ {t.matchExpired}
          </div>
        ) : isWinner ? (
          <div className="text-green-600 font-black flex items-center gap-1">
            🏆 {t.youWon}
          </div>
        ) : isLoser ? (
          <div className="text-red-600 font-black flex items-center gap-1">
            💔 {t.youLost}
          </div>
        ) : isDraw ? (
          <div className="text-orange-600 font-black flex items-center gap-1">
            🤝 {t.draw}
          </div>
        ) : isCreated ? (
          <div className="text-blue-600 font-black flex items-center gap-1">
            ⏳ {t.waitingForOpponent}
          </div>
        ) : null}
      </div>

      {canClaim && (
        <button
          onClick={() => claim(matchId)}
          disabled={isProcessing}
          className="w-full text-xs px-2 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-black font-black rounded border-2 border-black disabled:opacity-50 transition-all"
        >
          💰 {t.claim}
        </button>
      )}
      {canExpire && (
        <button
          onClick={() => expireCreated(matchId)}
          disabled={isProcessing}
          className="w-full text-xs px-2 py-1.5 bg-red-400 hover:bg-red-500 text-white font-black rounded border-2 border-red-700 disabled:opacity-50 transition-all"
        >
          ⌛ {t.markExpired}
        </button>
      )}
      {actuallyExpired && isMyMatch && (
        <button
          onClick={() => claim(matchId)}
          disabled={isProcessing}
          className="w-full text-xs px-2 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-black font-black rounded border-2 border-black disabled:opacity-50 transition-all"
        >
          💰 {t.refund}
        </button>
      )}
    </div>
  );
}

export default function RPSPage() {
  const [lang, setLang] = useState<Language>("en");
  
  useEffect(() => {
    setLang(getBrowserLanguage());
  }, []);
  
  const t = translations[lang];
  
  const { chainId, accounts, isConnected } = useWagmiEthers();
  const address = accounts?.[0];

  // FHEVM 初始化
  const providerForFhevm = useMemo(() => {
    return "https://ethereum-sepolia-rpc.publicnode.com";
  }, []);

  const { instance, status: fheStatus } = useFhevm({ 
    provider: providerForFhevm as any, 
    chainId: 11155111
  });
  const isReady = fheStatus === "ready";

  const {
    contractAddress,
    currentMatchId,
    status,
    encOutcomeHandle,
    clearWinner,
    isDecrypting,
    isProcessing,
    isMatching,
    message,
    selectedMode,
    selectedStake,
    setSelectedMode,
    setSelectedStake,
    playMove,
    getPendingMatchCount,
    getValidPendingMatchCount,
    resolveMatch,
    claim,
    decryptWinner,
    expireCreated,
    refreshStatus,
    matchHistory,
    isLoadingHistory,
    fetchMatchHistory,
  } = usePrivateRPSWagmi({ instance });

  const [stakeInput, setStakeInput] = useState<string>("0.001");
  const [pendingCount, setPendingCount] = useState<number>(0);

  // 自动刷新历史记录 - 初始加载 + 每15秒刷新
  useEffect(() => {
    if (!address) return;
    
    // 立即执行一次
    fetchMatchHistory(address);
    
    // 然后每15秒刷新一次
    const interval = setInterval(() => {
      fetchMatchHistory(address);
    }, 15000); // 15秒，避免RPC频率限制

    return () => clearInterval(interval);
  }, [address, fetchMatchHistory]);

  // 解析对局状态
  const matchState = useMemo(() => {
    if (!status) return undefined;
    const [state, playerA, playerB, stakeWei, deadline, mode, winner] = status;
    const stateNames = ["已创建", "已加入", "已锁定", "已判定", "已过期"];
    return {
      state,
      stateName: stateNames[state] || "未知",
      playerA,
      playerB,
      stakeWei,
      deadline: Number(deadline),
      mode: mode as MatchMode,
      winner,
      isMyTurn: address && (playerA.toLowerCase() === address.toLowerCase() || playerB.toLowerCase() === address.toLowerCase()),
      amIPlayerA: address && playerA.toLowerCase() === address.toLowerCase(),
      isWaiting: state === 0,
      isLocked: state === 2,
      isResolved: state === 3,
    };
  }, [status, address]);

  // 自动查询匹配池
  useEffect(() => {
    if (!selectedMode || !selectedStake || !address) return;
    const interval = setInterval(async () => {
      const count = await getValidPendingMatchCount(selectedMode, selectedStake, address);
      setPendingCount(count);
    }, 3000);

    getValidPendingMatchCount(selectedMode, selectedStake, address).then(setPendingCount);
    return () => clearInterval(interval);
  }, [selectedMode, selectedStake, address, getValidPendingMatchCount]);

  const handlePlayMove = async (move: Move) => {
    const stake = selectedMode === 1 ? parseEther(stakeInput) : 0n;
    const matchId = await playMove(move, selectedMode, stake, 600);
    // TX 成功后刷新状态
    if (matchId) {
      setTimeout(() => {
        refreshStatus();
      }, 2000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-yellow-100 to-amber-50">
      {/* FHE 功能降级警告（仅在 WASM 加载失败时显示） */}
      {!isReady && isConnected && (
        <div className="bg-orange-100 border-b-2 border-orange-400 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-start gap-3 text-sm">
            <div className="text-2xl">⚠️</div>
            <div className="flex-1">
              <div className="font-bold text-orange-900 mb-1">
                {lang === "en" ? "FHE Encryption Unavailable on Vercel" : "FHE 加密在 Vercel 上不可用"}
              </div>
              <div className="text-orange-800">
                {lang === "en" 
                  ? "WASM loading is blocked due to incompatibility between FHEVM's security requirements and wallet popup needs. For full encryption features, please clone and run locally. You can still browse match history and blockchain data here."
                  : "由于 FHEVM 的安全要求与钱包弹窗需求不兼容，WASM 加载被阻止。要使用完整加密功能，请克隆并在本地运行。您仍可在此浏览对局历史和区块链数据。"}
              </div>
              <a 
                href="https://github.com/SolemnFling/zama-fhe-rps#readme" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-900 underline font-semibold hover:text-orange-700 mt-1 inline-block"
              >
                {lang === "en" ? "→ GitHub Repository & Local Setup" : "→ GitHub 仓库与本地运行"}
              </a>
            </div>
          </div>
        </div>
      )}
      
      {/* 顶部状态栏 */}
      <div className="bg-yellow-400 border-b border-yellow-600 shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-3xl font-black text-black tracking-tighter">⚡ RPS</div>
            <div className="h-6 w-px bg-black/20"></div>
            <div className="text-xs text-black/70 uppercase tracking-wider font-bold">FHEVM Powered</div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {/* 语言切换按钮 */}
            <button
              onClick={() => setLang(lang === "en" ? "zh" : "en")}
              className="px-3 py-1.5 rounded-lg bg-black text-yellow-400 border-2 border-black font-bold hover:bg-gray-800 transition-colors"
            >
              {lang === "en" ? "中文" : "EN"}
            </button>
            {!isConnected ? (
              <div className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 border-2 border-red-300 font-semibold">
                ❌ {t.disconnected}
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded-lg bg-green-100 text-green-700 border-2 border-green-300 font-semibold">
                ✅ {t.connected}
              </div>
            )}
            <div className={`px-3 py-1.5 rounded-lg border-2 font-semibold ${
              isReady 
                ? "bg-yellow-200 text-black border-yellow-400" 
                : "bg-gray-100 text-gray-600 border-gray-300"
            }`}>
              {isReady ? "⚡ Ready" : `⏳ ${fheStatus}`}
            </div>
            {address && (
              <div className="px-3 py-1.5 rounded-lg bg-black text-yellow-400 border-2 border-black font-mono font-bold">
                {address.slice(0, 6)}...{address.slice(-4)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 主内容区 - 双栏布局 */}
      <div className="max-w-7xl mx-auto px-6 py-8 flex gap-6">
        {/* 主区域 */}
        <div className="flex-1 space-y-6">
          {/* 游戏模式选择 */}
          <div className="bg-white rounded-2xl border-4 border-yellow-400 shadow-xl p-6">
            <h2 className="text-2xl font-black text-black mb-4">🎮 {t.selectMode}</h2>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setSelectedMode(0)}
                className={`p-6 rounded-xl border-3 transition-all ${
                  selectedMode === 0
                    ? "bg-yellow-400 border-black text-black shadow-lg scale-105"
                    : "bg-yellow-100 border-yellow-300 text-black/60 hover:border-yellow-400 hover:bg-yellow-200"
                }`}
              >
                <div className="text-3xl mb-2">🏃</div>
                <div className="font-black text-lg">{t.practiceMode}</div>
                <div className="text-xs font-semibold opacity-70">{t.free}</div>
              </button>
              <button
                onClick={() => setSelectedMode(1)}
                className={`p-6 rounded-xl border-3 transition-all ${
                  selectedMode === 1
                    ? "bg-yellow-400 border-black text-black shadow-lg scale-105"
                    : "bg-yellow-100 border-yellow-300 text-black/60 hover:border-yellow-400 hover:bg-yellow-200"
                }`}
              >
                <div className="text-3xl mb-2">💰</div>
                <div className="font-black text-lg">{t.wagerMode}</div>
                <div className="text-xs font-semibold opacity-70">0.001 ETH</div>
              </button>
            </div>

            {selectedMode === 1 && (
              <div className="mt-4 p-4 rounded-xl bg-yellow-200 border-2 border-yellow-400">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black/70 font-semibold">{t.matchPool}</span>
                  <span className="text-black font-black">{pendingCount} {t.matches}</span>
                </div>
              </div>
            )}
          </div>

          {/* 出手区域 */}
          <div className="bg-white rounded-2xl border-4 border-yellow-400 shadow-xl p-6">
            <h2 className="text-2xl font-black text-black mb-6">✊✋✌️ {t.yourMove}</h2>
            <div className="grid grid-cols-3 gap-6">
              {[
                { move: 0 as Move, icon: "✊", name: t.rock, color: "red" },
                { move: 1 as Move, icon: "✋", name: t.paper, color: "blue" },
                { move: 2 as Move, icon: "✌️", name: t.scissors, color: "green" },
              ].map(({ move, icon, name, color }) => (
                <button
                  key={move}
                  disabled={isProcessing || !address || !instance}
                  onClick={() => handlePlayMove(move)}
                  className="group relative overflow-hidden bg-gradient-to-br from-yellow-300 to-yellow-400 border-4 border-yellow-600 rounded-2xl p-8 hover:border-black hover:shadow-2xl hover:scale-105 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <div className="text-6xl mb-3">{icon}</div>
                  <div className="text-xl font-black text-black">{name}</div>
                  {isMatching && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-4 border-yellow-500 border-t-transparent"></div>
                    </div>
                  )}
                </button>
              ))}
            </div>

            {!address && (
              <div className="mt-4 text-center py-3 px-4 bg-red-100 text-red-700 font-bold rounded-xl border-2 border-red-400">
                ⚠️ {t.connectWallet}
              </div>
            )}
          </div>

          {/* 当前对局状态 */}
          {matchState && (
            <div className="bg-white rounded-2xl border-4 border-yellow-400 shadow-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-black text-black">📊 {t.matchStatus}</h2>
                <button
                  onClick={refreshStatus}
                  className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 rounded-lg text-black font-bold border-2 border-black transition-all"
                >
                  🔄 {t.refresh}
                </button>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between p-3 bg-yellow-100 rounded-lg border-2 border-yellow-300">
                  <span className="text-black/70 font-semibold">{t.status}</span>
                  <span className="text-black font-black">{matchState.stateName}</span>
                </div>
                <div className="flex justify-between p-3 bg-yellow-100 rounded-lg border-2 border-yellow-300">
                  <span className="text-black/70 font-semibold">{t.playerA}</span>
                  <span className="text-black font-mono text-xs font-bold">{matchState.playerA.slice(0, 10)}...</span>
                </div>
                {matchState.playerB !== ethers.ZeroAddress && (
                  <div className="flex justify-between p-3 bg-yellow-100 rounded-lg border-2 border-yellow-300">
                    <span className="text-black/70 font-semibold">{t.playerB}</span>
                    <span className="text-black font-mono text-xs font-bold">{matchState.playerB.slice(0, 10)}...</span>
                  </div>
                )}
                {matchState.isResolved && matchState.winner !== ethers.ZeroAddress && (
                  <div className="flex justify-between p-3 bg-green-100 rounded-lg border-2 border-green-400">
                    <span className="text-green-700 font-bold">🏆 {t.winner}</span>
                    <span className="text-green-900 font-mono text-xs font-black">{matchState.winner.slice(0, 10)}...</span>
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="mt-4 flex gap-3">
                {matchState.isLocked && (
                  <button
                    onClick={() => resolveMatch(currentMatchId)}
                    disabled={isProcessing}
                    className="flex-1 px-6 py-3 bg-yellow-400 hover:bg-yellow-500 text-black font-black text-lg rounded-xl border-4 border-black disabled:opacity-50 transition-all shadow-lg"
                  >
                    ⚡ {t.resolve}
                  </button>
                )}
                {matchState.isResolved && matchState.winner.toLowerCase() === address?.toLowerCase() && (
                  <button
                    onClick={() => claim(currentMatchId)}
                    disabled={isProcessing}
                    className="flex-1 px-6 py-3 bg-green-400 hover:bg-green-500 text-black font-black text-lg rounded-xl border-4 border-green-700 disabled:opacity-50 transition-all shadow-lg"
                  >
                    💰 {t.claim}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 消息提示 */}
          {message && (
            <div className="bg-yellow-100 rounded-xl border-2 border-yellow-400 p-4 shadow-md">
              <div className="text-black text-sm font-bold">{message}</div>
            </div>
          )}
        </div>

        {/* 侧边栏 - 历史记录 */}
        <div className="w-80 space-y-4">
          <div className="bg-white rounded-2xl border-4 border-yellow-400 shadow-xl p-6 sticky top-24 max-h-[calc(100vh-8rem)] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black text-black">📜 {t.matchHistory}</h2>
              <button
                onClick={async () => {
                  if (address) {
                    await fetchMatchHistory(address);
                  }
                }}
                disabled={isLoadingHistory}
                className="text-xs px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 rounded text-black font-bold border-2 border-black disabled:opacity-50"
              >
                {isLoadingHistory ? "..." : t.refresh}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-yellow-500/40 scrollbar-track-transparent">
              {matchHistory.length === 0 ? (
                <div className="text-center py-8 text-black/50 text-sm font-semibold">
                  {isLoadingHistory ? t.loading : t.noMatches}
                </div>
              ) : (
                matchHistory.slice(0, 20).map((matchId) => (
                  <CompactHistoryCard
                    key={matchId}
                    matchId={matchId}
                    contractAddress={contractAddress!}
                    myAddress={address!}
                    claim={claim}
                    expireCreated={expireCreated}
                    isProcessing={isProcessing}
                    lang={lang}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
