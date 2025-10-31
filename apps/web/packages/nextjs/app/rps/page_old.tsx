"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useFhevm } from "fhevm-sdk/react";
import { formatEther, parseEther } from "viem";
import { type MatchMode, type Move, usePrivateRPSWagmi } from "~~/hooks/private-rps/usePrivateRPSWagmi";
import { useWagmiEthers } from "~~/hooks/wagmi/useWagmiEthers";
import scaffoldConfig from "~~/scaffold.config";
import { ethers } from "ethers";

// 历史记录卡片组件
function HistoryMatchCard({
  matchId,
  contractAddress,
  myAddress,
  claim,
  expireCreated,
  isProcessing,
}: {
  matchId: string;
  contractAddress: string;
  myAddress: string;
  claim: (matchId: string) => Promise<void>;
  expireCreated: (matchId: string) => Promise<void>;
  isProcessing: boolean;
}) {
  const [matchData, setMatchData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMatchData = async () => {
      try {
        // 优先使用钱包 Provider；若网络不匹配或报错则回退到只读 RPC
        let provider: any;
        try {
          const browserProvider = new ethers.BrowserProvider((window as any).ethereum);
          const net = await browserProvider.getNetwork();
          if (Number(net?.chainId || 0) !== 11155111) {
            throw new Error(`Wrong chain: ${String(net?.chainId)}`);
          }
          provider = browserProvider;
        } catch (err) {
          const rpc = (scaffoldConfig.rpcOverrides as any)?.[11155111];
          console.warn("HistoryMatchCard: fallback to JSON RPC for read", rpc);
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

  if (loading) return <div className="p-4 bg-white/5 rounded-lg text-slate-400 text-sm">加载中...</div>;
  if (!matchData) return null;

  const stateNames = ["已创建", "已加入", "已锁定", "已判定", "已过期"];
  const isExpired = matchData.state === 4;
  const isCreated = matchData.state === 0;
  const isResolved = matchData.state === 3;
  const isMyMatch = matchData.playerA.toLowerCase() === myAddress.toLowerCase() ||
                     matchData.playerB.toLowerCase() === myAddress.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const isDeadlinePassed = matchData.deadline < now;
  const hasPlayerB = matchData.playerB !== "0x0000000000000000000000000000000000000000";

  return (
    <div className="p-4 bg-white/5 rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-400 font-mono">
          {matchId.slice(0, 8)}...{matchId.slice(-6)}
        </div>
        <div className={`text-xs font-semibold px-2 py-1 rounded ${
          isExpired ? "bg-red-500/20 text-red-300" :
          isResolved ? "bg-green-500/20 text-green-300" :
          isCreated ? "bg-yellow-500/20 text-yellow-300" :
          "bg-blue-500/20 text-blue-300"
        }`}>
          {stateNames[matchData.state]}
        </div>
      </div>

      <div className="text-sm text-slate-300">
        {matchData.mode === 1 && <span>💰 {formatEther(matchData.stake)} ETH</span>}
        {matchData.mode === 0 && <span>🏃 练习模式</span>}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        {isMyMatch && isCreated && !hasPlayerB && isDeadlinePassed && (
          <button
            onClick={() => expireCreated(matchId)}
            disabled={isProcessing}
            className="flex-1 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded disabled:opacity-50"
          >
            ⏰ 标记过期
          </button>
        )}
        {isMyMatch && isExpired && matchData.mode === 1 && (
          <button
            onClick={() => claim(matchId)}
            disabled={isProcessing}
            className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded disabled:opacity-50"
          >
            💰 取回押金
          </button>
        )}
        {isMyMatch && isResolved && matchData.winner.toLowerCase() === myAddress.toLowerCase() && matchData.mode === 1 && (
          <button
            onClick={() => claim(matchId)}
            disabled={isProcessing}
            className="flex-1 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm rounded disabled:opacity-50"
          >
            🏆 领取奖励
          </button>
        )}
      </div>
    </div>
  );
}

export default function RPSPage() {
  const { chainId, accounts, isConnected } = useWagmiEthers();
  const address = accounts?.[0];

  // FHEVM 初始化 - 使用 PublicNode Sepolia RPC
  const providerForFhevm = useMemo(() => {
    return "https://ethereum-sepolia-rpc.publicnode.com";
  }, []);

  const { instance, status: fheStatus } = useFhevm({ 
    provider: providerForFhevm as any, 
    chainId: 11155111 // Sepolia
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

  // UI 状态
  const [stakeInput, setStakeInput] = useState<string>("0.001");
  const [pendingCount, setPendingCount] = useState<number>(0);

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
      isWaiting: state === 0, // CREATED
      isLocked: state === 2, // LOCKED
      isResolved: state === 3, // RESOLVED
    };
  }, [status, address]);

  // 自动查询匹配池 (使用过滤后的有效对局数量)
  useEffect(() => {
    if (!selectedMode || !selectedStake || !address) return;
    const interval = setInterval(async () => {
      const count = await getValidPendingMatchCount(selectedMode, selectedStake, address);
      setPendingCount(count);
    }, 3000);

    // 立即查询一次
    getValidPendingMatchCount(selectedMode, selectedStake, address).then(setPendingCount);

    return () => clearInterval(interval);
  }, [selectedMode, selectedStake, address, getValidPendingMatchCount]);

  // 处理出手
  const handlePlayMove = async (move: Move) => {
    const stake = selectedMode === 1 ? parseEther(stakeInput) : 0n;
    await playMove(move, selectedMode, stake, 600); // 10分钟截止
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* 标题 */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-white">🎮 隐私石头剪刀布</h1>
          <p className="text-slate-300">基于 FHEVM 的完全加密对战游戏</p>
          <div className="flex justify-center gap-4 text-sm flex-wrap">
            {!isConnected ? (
              <span className="px-3 py-1 rounded-full bg-red-500/20 text-red-300">
                ❌ 未连接钱包 (请点击右上角连接)
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-300">
                ✅ 钱包已连接
              </span>
            )}
            <span className={`px-3 py-1 rounded-full ${isReady ? "bg-green-500/20 text-green-300" : "bg-yellow-500/20 text-yellow-300"}`}>
              {isReady ? "✅ FHEVM 就绪" : `⏳ ${fheStatus}`}
            </span>
            {contractAddress && (
              <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300">
                📝 {contractAddress.slice(0, 6)}...{contractAddress.slice(-4)}
              </span>
            )}
            {address && (
              <span className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300">
                👤 {address.slice(0, 6)}...{address.slice(-4)}
              </span>
            )}
          </div>
        </div>

        {/* 游戏设置 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 space-y-4 border border-white/20">
          <h2 className="text-xl font-bold text-white">⚙️ 游戏设置</h2>

          {/* 模式选择 */}
          <div className="space-y-2">
            <label className="text-sm text-slate-300">游戏模式</label>
            <div className="flex gap-3">
              <button
                className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-all ${
                  selectedMode === 0
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/50"
                    : "bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
                onClick={() => setSelectedMode(0)}
              >
                🏃 练习模式
              </button>
              <button
                className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-all ${
                  selectedMode === 1
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-500/50"
                    : "bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
                onClick={() => setSelectedMode(1)}
              >
                💰 真实模式
              </button>
            </div>
          </div>

          {/* 下注金额 - 固定 0.001 ETH */}
          {selectedMode === 1 && (
            <div className="space-y-2">
              <label className="text-sm text-slate-300">下注金额</label>
              <div className="px-4 py-3 rounded-lg bg-green-600/20 border border-green-500/30 text-white font-semibold text-center">
                💰 0.001 ETH
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span>📊 当前匹配池: {pendingCount} 个对局等待中</span>
                {pendingCount > 0 && <span className="px-2 py-1 bg-green-500/20 text-green-300 rounded">有对手!</span>}
              </div>
            </div>
          )}
        </div>

        {/* 出手区域 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 space-y-4 border border-white/20">
          <h2 className="text-xl font-bold text-white">✊✋✌️ 选择你的出手</h2>

          <div className="grid grid-cols-3 gap-4">
            {[
              { move: 0 as Move, icon: "✊", name: "石头", color: "from-red-500 to-orange-500" },
              { move: 1 as Move, icon: "✋", name: "布", color: "from-blue-500 to-cyan-500" },
              { move: 2 as Move, icon: "✌️", name: "剪刀", color: "from-green-500 to-emerald-500" },
            ].map(({ move, icon, name, color }) => (
              <button
                key={move}
                disabled={isProcessing || !address || !instance}
                onClick={() => handlePlayMove(move)}
                className={`relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed
                  bg-gradient-to-br ${color} p-8 rounded-xl shadow-lg
                  hover:scale-105 hover:shadow-2xl transition-all duration-300`}
              >
                <div className="text-6xl mb-2">{icon}</div>
                <div className="text-xl font-bold text-white">{name}</div>
                {isMatching && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent"></div>
                  </div>
                )}
              </button>
            ))}
          </div>

          {!address && (
            <div className="text-center py-4 px-6 bg-yellow-500/20 text-yellow-300 rounded-lg">
              ⚠️ 请先连接钱包
            </div>
          )}
        </div>

        {/* 对局状态 */}
        {matchState && (
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 space-y-4 border border-white/20">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">📊 对局信息</h2>
              <button
                onClick={refreshStatus}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-all"
              >
                🔄 刷新
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm text-slate-400">对局 ID</div>
                <div className="text-xs text-white font-mono bg-black/30 p-2 rounded">
                  {currentMatchId.slice(0, 10)}...{currentMatchId.slice(-8)}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-slate-400">状态</div>
                <div className={`text-lg font-bold ${
                  matchState.isWaiting ? "text-yellow-300" :
                  matchState.isLocked ? "text-blue-300" :
                  matchState.isResolved ? "text-green-300" : "text-slate-300"
                }`}>
                  {matchState.stateName}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-slate-400">玩家 A {matchState.amIPlayerA && "(你)"}</div>
                <div className="text-xs text-white font-mono bg-black/30 p-2 rounded">
                  {matchState.playerA.slice(0, 6)}...{matchState.playerA.slice(-4)}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-slate-400">玩家 B {!matchState.amIPlayerA && matchState.isMyTurn && "(你)"}</div>
                <div className="text-xs text-white font-mono bg-black/30 p-2 rounded">
                  {matchState.playerB === "0x0000000000000000000000000000000000000000"
                    ? "等待中..."
                    : `${matchState.playerB.slice(0, 6)}...${matchState.playerB.slice(-4)}`}
                </div>
              </div>
            </div>

            {matchState.mode === 1 && (
              <div className="flex items-center gap-2 text-lg">
                <span className="text-slate-400">💰 奖池:</span>
                <span className="text-yellow-300 font-bold">
                  {formatEther(matchState.stakeWei * 2n)} ETH
                </span>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3">
              {matchState.isLocked && (
                <button
                  onClick={() => resolveMatch(currentMatchId)}
                  disabled={isProcessing}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700
                    text-white font-bold rounded-lg shadow-lg disabled:opacity-50 transition-all"
                >
                  ⚖️ 判定结果
                </button>
              )}
              {matchState.isResolved && matchState.winner !== "0x0000000000000000000000000000000000000000" && (
                <button
                  onClick={() => claim(currentMatchId)}
                  disabled={isProcessing}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700
                    text-white font-bold rounded-lg shadow-lg disabled:opacity-50 transition-all"
                >
                  💎 领取奖励
                </button>
              )}
            </div>

            {/* 赢家信息 */}
            {matchState.isResolved && (
              <div className="space-y-3 p-4 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 rounded-lg border border-yellow-500/50">
                <div className="text-lg font-bold text-yellow-300">🏆 比赛结果</div>
                {matchState.winner === "0x0000000000000000000000000000000000000000" ? (
                  <div className="text-white">🤝 平局!</div>
                ) : (
                  <>
                    <div className="text-sm text-slate-300">赢家 (链上)</div>
                    <div className="text-xs text-white font-mono bg-black/30 p-2 rounded">
                      {matchState.winner.slice(0, 10)}...{matchState.winner.slice(-8)}
                    </div>
                    {encOutcomeHandle && (
                      <div className="space-y-2">
                        <button
                          onClick={decryptWinner}
                          disabled={isDecrypting}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-all"
                        >
                          {isDecrypting ? "🔓 解密中..." : "🔓 本地解密赢家"}
                        </button>
                        {clearWinner && (
                          <div className="text-xs text-green-300 font-mono bg-black/30 p-2 rounded">
                            ✅ {clearWinner.slice(0, 10)}...{clearWinner.slice(-8)}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* 消息提示 */}
        {message && (
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-4 border border-white/20">
            <div className="text-sm text-white">{message}</div>
          </div>
        )}

        {/* 历史记录 */}
        {address && contractAddress && (
          <div className="bg-white/5 backdrop-blur-lg rounded-xl p-6 space-y-4 border border-white/10">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">
                📜 对局历史 {matchHistory.length > 0 && `(${matchHistory.length} 场)`}
              </h3>
              <button
                onClick={async () => {
                  if (address) {
                    const history = await fetchMatchHistory(address);
                    console.log("刷新历史记录:", history);
                  }
                }}
                disabled={isLoadingHistory}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-all disabled:opacity-50"
              >
                {isLoadingHistory ? "🔄 加载中..." : "🔄 刷新历史"}
              </button>
            </div>

            {isLoadingHistory ? (
              <div className="text-center py-8 text-slate-400">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-4"></div>
                加载历史记录中...
              </div>
            ) : matchHistory.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                📭 暂无对局历史
                <p className="text-sm mt-2">创建或加入对局后会显示在这里</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {matchHistory.slice(0, 10).map((matchId) => (
                  <HistoryMatchCard
                    key={matchId}
                    matchId={matchId}
                    contractAddress={contractAddress}
                    myAddress={address}
                    claim={claim}
                    expireCreated={expireCreated}
                    isProcessing={isProcessing}
                  />
                ))}
                {matchHistory.length > 10 && (
                  <div className="text-center text-sm text-slate-400 py-2">
                    还有 {matchHistory.length - 10} 场对局未显示
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 使用说明 */}
        <div className="bg-white/5 backdrop-blur-lg rounded-xl p-6 space-y-3 border border-white/10">
          <h3 className="text-lg font-bold text-white">📖 游戏说明</h3>
          <ul className="space-y-2 text-sm text-slate-300">
            <li>✅ <strong>选择模式和金额</strong> - 练习模式免费，真实模式需要下注</li>
            <li>✅ <strong>点击出手</strong> - 系统自动查找匹配（最多10秒），找不到则创建新对局</li>
            <li>✅ <strong>等待对手</strong> - 对局创建后，等待其他玩家加入</li>
            <li>✅ <strong>判定结果</strong> - 双方出手后，点击"判定结果"触发智能合约计算</li>
            <li>✅ <strong>领取奖励</strong> - 赢家可领取奖池，平局则各自退回押金</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
