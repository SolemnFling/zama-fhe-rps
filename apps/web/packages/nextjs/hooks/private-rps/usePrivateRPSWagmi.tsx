import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeployedContractInfo } from "../helper";
import { useWagmiEthers } from "../wagmi/useWagmiEthers";
import { ethers } from "ethers";
import {
  FhevmInstance,
  getEncryptionMethod,
  useFHEDecrypt,
  useFHEEncryption,
  useInMemoryStorage,
} from "fhevm-sdk";
import { useReadContract } from "wagmi";
import type { AllowedChainIds } from "~~/utils/helper/networks";

export type MatchMode = 0 | 1; // PRACTICE=0, WAGER=1
export type Move = 0 | 1 | 2; // ROCK=0, PAPER=1, SCISSORS=2

export const usePrivateRPSWagmi = (params: {
  instance?: FhevmInstance;
  initialMockChains?: Readonly<Record<number, string>>;
}) => {
  const { instance, initialMockChains } = params;
  const { storage: fhevmDecryptionSignatureStorage } = useInMemoryStorage();

  const { chainId, ethersReadonlyProvider, ethersSigner } = useWagmiEthers(initialMockChains);
  const allowedChainId = typeof chainId === "number" ? (chainId as AllowedChainIds) : undefined;
  const { data: contract } = useDeployedContractInfo({ contractName: "PrivateRPS", chainId: allowedChainId });

  const [message, setMessage] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isMatching, setIsMatching] = useState<boolean>(false);

  const hasContract = Boolean(contract?.address && contract?.abi);
  const hasProvider = Boolean(ethersReadonlyProvider);
  const hasSigner = Boolean(ethersSigner);

  const getContract = (mode: "read" | "write") => {
    if (!hasContract) return undefined;
    const providerOrSigner = mode === "read" ? ethersReadonlyProvider : ethersSigner;
    if (!providerOrSigner) return undefined;
    return new ethers.Contract(contract!.address, contract!.abi as any, providerOrSigner);
  };

  // --- 辅助函数: 轮询获取交易回执 (避免 RPC 超时) ---
  const pollReceipt = async (
    txHash: string,
    setMessage: (msg: string) => void,
    maxAttempts = 30,
    intervalMs = 2000
  ): Promise<ethers.TransactionReceipt> => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const receipt = await ethersReadonlyProvider!.getTransactionReceipt(txHash);
        if (receipt && receipt.blockNumber) {
          return receipt;
        }
      } catch (err: any) {
        console.warn(`轮询回执失败 (${i + 1}/${maxAttempts}):`, err.message);
      }
      
      // 更新进度消息
      if (i % 5 === 4 || i === maxAttempts - 1) {
        setMessage(`⏳ 等待确认中... (${i + 1}/${maxAttempts})`);
      }
      
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error('交易已发送但无法获取回执，请稍后在历史记录中查看');
  };

  // --- State ---
  const [currentMatchId, setCurrentMatchId] = useState<string>("0x" + "0".repeat(64));
  const [selectedMode, setSelectedMode] = useState<MatchMode>(1); // 默认 WAGER
  const [selectedStake, setSelectedStake] = useState<bigint>(ethers.parseEther("0.001"));

  // --- 历史记录管理 (链上事件查询) ---
  const [matchHistory, setMatchHistory] = useState<string[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);

  // 查询用户参与的所有对局（通过事件）
  const fetchMatchHistory = useCallback(
    async (userAddress: string): Promise<string[]> => {
      if (!hasContract || !hasProvider || !ethersReadonlyProvider) {
        console.log("⚠️ 缺少必要条件:", { hasContract, hasProvider, hasReadonlyProvider: !!ethersReadonlyProvider });
        return [];
      }
      setIsLoadingHistory(true);
      try {
        const read = new ethers.Contract(contract!.address, contract!.abi as any, ethersReadonlyProvider);
        console.log("📡 查询合约事件:", contract!.address);

        // 查询用户作为 playerA 创建的对局（最近2000块，约8小时）
        console.log("🔍 查询 MatchCreated 事件...");
        const createdEvents = await read.queryFilter(read.filters.MatchCreated(null, userAddress), -2000, "latest");
        const createdMatchIds = createdEvents.map((e: any) => ({ matchId: e.args.matchId, blockNumber: e.blockNumber }));
        console.log(`   找到 ${createdMatchIds.length} 个创建的对局`);

        // 查询用户作为 playerB 加入的对局（最近2000块，约8小时）
        console.log("🔍 查询 MatchJoined 事件...");
        const joinedEvents = await read.queryFilter(read.filters.MatchJoined(null, userAddress), -2000, "latest");
        const joinedMatchIds = joinedEvents.map((e: any) => ({ matchId: e.args.matchId, blockNumber: e.blockNumber }));
        console.log(`   找到 ${joinedMatchIds.length} 个加入的对局`);

        // 合并并按区块号排序（最新的在前）
        const allMatches = [...createdMatchIds, ...joinedMatchIds];
        const uniqueMatchMap = new Map<string, number>();
        allMatches.forEach(({ matchId, blockNumber }) => {
          const existing = uniqueMatchMap.get(matchId);
          if (!existing || blockNumber > existing) {
            uniqueMatchMap.set(matchId, blockNumber);
          }
        });
        
        // 按区块号降序排序（最新的在最前面）
        const sortedMatchIds = Array.from(uniqueMatchMap.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([matchId]) => matchId);
        
        console.log(`✅ 总共 ${sortedMatchIds.length} 个对局（已排序）`);
        // 同步更新本地状态，便于外部调用者无需手动 set
        setMatchHistory(sortedMatchIds);
        return sortedMatchIds;
      } catch (e) {
        console.error("❌ fetchMatchHistory 失败:", e);
        // 失败时不清空现有数据
        return matchHistory;
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [hasContract, hasProvider, ethersReadonlyProvider, contract, matchHistory],
  );

  // 初始化历史记录（当有地址时）- 暂时禁用自动加载以避免RPC限流
  // useEffect(() => {
  //   const loadHistory = async () => {
  //     if (!ethersSigner || !hasContract || !ethersReadonlyProvider) return;
  //     try {
  //       const address = await ethersSigner.getAddress();
  //       console.log("🔍 加载历史记录，地址:", address);
  //       const history = await fetchMatchHistory(address);
  //       console.log("✅ 历史记录加载完成:", history.length, "场对局");
  //       setMatchHistory(history);
  //     } catch (e) {
  //       console.error("加载历史记录失败:", e);
  //       setIsLoadingHistory(false); // 确保停止加载状态
  //     }
  //   };
  //   loadHistory();
  // }, [ethersSigner, hasContract, ethersReadonlyProvider]); // 移除 fetchMatchHistory 依赖

  // --- Reads ---
  const statusRead = useReadContract({
    address: (hasContract ? (contract!.address as `0x${string}`) : undefined) as `0x${string}` | undefined,
    abi: (hasContract ? (contract!.abi as any) : undefined) as any,
    functionName: "getStatus" as const,
    args: currentMatchId && currentMatchId !== "0x" + "0".repeat(64) ? [currentMatchId as `0x${string}`] : undefined,
    query: {
      enabled: Boolean(hasContract && hasProvider && currentMatchId && currentMatchId !== "0x" + "0".repeat(64)),
      refetchOnWindowFocus: false,
    },
  });

  const status = statusRead.data as
    | undefined
    | readonly [number, `0x${string}`, `0x${string}`, bigint, bigint, number, `0x${string}`];

  // Encrypted outcome handle (只在 LOCKED 或 RESOLVED 状态可读)
  const encOutcomeRead = useReadContract({
    address: (hasContract ? (contract!.address as `0x${string}`) : undefined) as `0x${string}` | undefined,
    abi: (hasContract ? (contract!.abi as any) : undefined) as any,
    functionName: "getEncryptedOutcome" as const,
    args: currentMatchId && currentMatchId !== "0x" + "0".repeat(64) ? [currentMatchId as `0x${string}`] : undefined,
    query: {
      enabled: Boolean(hasContract && hasProvider && status && (status[0] === 2 || status[0] === 3)),
      refetchOnWindowFocus: false,
    },
  });

  const encOutcomeHandle = encOutcomeRead.data as string | undefined;

  // 自动轮询：每 6 秒刷新一次状态与密态结果
  useEffect(() => {
    const zero = "0x" + "0".repeat(64);
    if (!hasContract || !hasProvider || !currentMatchId || currentMatchId === zero) return;
    const id = setInterval(() => {
      statusRead.refetch();
      encOutcomeRead.refetch();
    }, 6000);
    return () => clearInterval(id);
  }, [hasContract, hasProvider, currentMatchId, statusRead, encOutcomeRead]);

  // 手动刷新
  const refreshStatusRef = useRef<{ refresh: () => Promise<void> }>({
    refresh: async () => {
      await statusRead.refetch();
      await encOutcomeRead.refetch();
    },
  });

  // Decrypt winner address
  const { decrypt, results, isDecrypting } = useFHEDecrypt({
    instance,
    ethersSigner: ethersSigner as any,
    fhevmDecryptionSignatureStorage,
    chainId,
    requests:
      encOutcomeHandle && encOutcomeHandle !== ethers.ZeroHash
        ? [{ handle: encOutcomeHandle, contractAddress: contract?.address! }]
        : undefined,
  });

  const clearWinner = encOutcomeHandle ? (results[encOutcomeHandle] as string | undefined) : undefined;

  // --- Encryption ---
  const { encryptWith } = useFHEEncryption({
    instance,
    ethersSigner: ethersSigner as any,
    contractAddress: contract?.address,
  });

  // --- 新接口: 查询匹配队列 ---
  const getPendingMatchCount = useCallback(
    async (mode: MatchMode, stakeWei: bigint): Promise<number> => {
      if (!hasContract || !hasProvider) return 0;
      try {
        const read = getContract("read")!;
        const count = await read.getPendingMatchCount(mode, stakeWei);
        return Number(count);
      } catch (e) {
        console.error("getPendingMatchCount 失败:", e);
        return 0;
      }
    },
    [hasContract, hasProvider],
  );

  const getPendingMatches = useCallback(
    async (
      mode: MatchMode,
      stakeWei: bigint,
      offset: number,
      limit: number,
    ): Promise<{ matchIds: string[]; total: number }> => {
      if (!hasContract || !hasProvider) return { matchIds: [], total: 0 };
      try {
        const read = getContract("read")!;
        const [matchIds, total] = await read.getPendingMatches(mode, stakeWei, offset, limit);
        return { matchIds: matchIds.map((id: any) => String(id)), total: Number(total) };
      } catch (e) {
        console.error("getPendingMatches 失败:", e);
        return { matchIds: [], total: 0 };
      }
    },
    [hasContract, hasProvider],
  );

  // --- 获取有效的匹配数量 (过滤过期和自己的对局) ---
  const getValidPendingMatchCount = useCallback(
    async (mode: MatchMode, stakeWei: bigint, myAddress?: string): Promise<number> => {
      if (!hasContract || !hasProvider) return 0;
      try {
        const read = getContract("read")!;
        const { matchIds } = await getPendingMatches(mode, stakeWei, 0, 20); // 查询更多以便过滤

        let validCount = 0;
        const now = Math.floor(Date.now() / 1000);

        for (const matchId of matchIds) {
          const status = await read.getStatus(matchId);
          const [state, playerA, , , deadline] = status;

          // 过滤条件:
          // 1. 状态必须是 CREATED (0)
          // 2. 未过期 (deadline > now)
          // 3. 不是自己创建的 (如果提供了 myAddress)
          const isValid =
            Number(state) === 0 &&
            Number(deadline) > now &&
            (!myAddress || playerA.toLowerCase() !== myAddress.toLowerCase());

          if (isValid) validCount++;
        }

        return validCount;
      } catch (e) {
        console.error("getValidPendingMatchCount 失败:", e);
        return 0;
      }
    },
    [hasContract, hasProvider, getPendingMatches],
  );

  // --- 核心功能: 出手并匹配 (前端实现10秒超时逻辑) ---
  const playMove = useCallback(
    async (move: Move, mode: MatchMode, stakeWei: bigint, deadlineSecFromNow: number, timeoutMs = 10000) => {
      if (!hasSigner || !hasContract || !instance) return setMessage("缺少合约/签名器/FHE 实例");
      setIsProcessing(true);
      setIsMatching(true);

      try {
        // 获取当前用户地址
        const myAddress = await ethersSigner!.getAddress();

        // 1. 查询匹配队列 (使用过滤逻辑)
        setMessage("🔍 正在查找匹配...");
        const startTime = Date.now();
        let foundMatchId: string | null = null;

        while (Date.now() - startTime < timeoutMs) {
          const { matchIds } = await getPendingMatches(mode, stakeWei, 0, 20);

          if (matchIds.length > 0) {
            const read = getContract("read")!;
            const now = Math.floor(Date.now() / 1000);

            // 遍历所有对局,找到第一个有效的
            for (const matchId of matchIds) {
              const status = await read.getStatus(matchId);
              const [state, playerA, , , deadline] = status;

              // 验证对局是否有效
              const isValid =
                Number(state) === 0 && // CREATED
                Number(deadline) > now && // 未过期
                playerA.toLowerCase() !== myAddress.toLowerCase(); // 不是自己的

              if (isValid) {
                foundMatchId = matchId;
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                setMessage(`✅ 找到有效对局! (耗时 ${elapsed}s)`);
                break;
              }
            }

            if (foundMatchId) break;
          }

          // 等待 1 秒后重试
          await new Promise(r => setTimeout(r, 1000));
        }

        setIsMatching(false);

        // 2. 加密出手
        const fn = (contract!.abi as readonly any[] as any[]).find(
          it => it.type === "function" && (it.name === "createAndCommit" || it.name === "joinAndCommit"),
        );
        const encMoveInput = fn?.inputs?.find((inp: any) => inp.name === "encMove");
        const method = encMoveInput ? getEncryptionMethod(encMoveInput.internalType) : undefined;
        if (!method) return setMessage("❌ 无法解析加密方法");

        const enc = await encryptWith(builder => {
          (builder as any)[method](move);
        });
        if (!enc) return setMessage("❌ 加密失败");

        const write = getContract("write")!;
        const now = Math.floor(Date.now() / 1000);
        const deadline = BigInt(now + deadlineSecFromNow);

        let tx: any;
        let matchId: string;

        if (foundMatchId) {
          // 3a. 加入对局
          setMessage(`⚡ 加入对局中...`);
          tx = await write.joinAndCommit(foundMatchId, enc.handles[0], enc.inputProof, {
            value: mode === 1 ? stakeWei : 0n,
          });
          setMessage(`⏳ 等待交易确认... (${tx.hash.slice(0, 10)}...)`);
          
          // 使用轮询方式获取回执
          const receipt = await pollReceipt(tx.hash, setMessage);
          
          matchId = foundMatchId;
          setMessage(`🎉 成功加入对局并出手! (${["石头", "布", "剪刀"][move]})`);
        } else {
          // 3b. 创建新对局
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          setMessage(`⏱ 超时 (${elapsed}s)，创建新对局...`);
          tx = await write.createAndCommit(enc.handles[0], enc.inputProof, mode, stakeWei, deadline, {
            value: mode === 1 ? stakeWei : 0n,
          });
          setMessage(`⏳ 等待交易确认... (${tx.hash.slice(0, 10)}...)`);
          
          // 使用轮询方式获取回执
          const receipt = await pollReceipt(tx.hash, setMessage);

          // 从事件提取 matchId
          const createEvent = receipt.logs.find((log: any) => {
            try {
              return write.interface.parseLog(log)?.name === "MatchCreated";
            } catch {
              return false;
            }
          });
          matchId = write.interface.parseLog(createEvent!)!.args.matchId;
          setMessage(`✅ 创建新对局成功! 等待对手匹配... (${["石头", "布", "剪刀"][move]})`);
        }

        setCurrentMatchId(matchId);
        // 重新查询历史记录以包含新对局 - 暂时禁用以避免RPC限流
        // if (ethersSigner) {
        //   const address = await ethersSigner.getAddress();
        //   const history = await fetchMatchHistory(address);
        //   setMatchHistory(history);
        // }
        await statusRead.refetch();
        return matchId;
      } catch (e) {
        setMessage(`❌ playMove 失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setIsProcessing(false);
        setIsMatching(false);
      }
    },
    [
      hasSigner,
      hasContract,
      instance,
      encryptWith,
      getPendingMatchCount,
      getPendingMatches,
      statusRead,
      contract?.abi,
    ],
  );

  // --- 判定 ---
  const resolveMatch = useCallback(
    async (matchId: string) => {
      if (!hasSigner || !hasContract) return setMessage("缺少合约或签名器");
      setIsProcessing(true);
      try {
        const write = getContract("write")!;
        const tx = await write.resolve(matchId);
        setMessage(`⏳ 等待交易确认... (${tx.hash.slice(0, 10)}...)`);
        
        // 使用轮询方式获取回执
        await pollReceipt(tx.hash, setMessage);
        
        setMessage("✅ 判定完成，等待解密...");
        await statusRead.refetch();
        await encOutcomeRead.refetch();
      } catch (e) {
        setMessage(`❌ resolve 失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [hasSigner, hasContract, statusRead, encOutcomeRead],
  );

  // --- 领取奖励 ---
  const claim = useCallback(
    async (matchId: string) => {
      if (!hasSigner || !hasContract) return setMessage("缺少合约或签名器");
      setIsProcessing(true);
      try {
        const write = getContract("write")!;
        const tx = await write.claim(matchId);
        setMessage(`⏳ 等待交易确认... (${tx.hash.slice(0, 10)}...)`);
        
        // 使用轮询方式获取回执
        await pollReceipt(tx.hash, setMessage);
        
        setMessage("✅ 领取成功!");
        await statusRead.refetch();
      } catch (e) {
        setMessage(`❌ claim 失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [hasSigner, hasContract],
  );

  // --- 解密赢家 ---
  const decryptWinner = useCallback(async () => {
    if (!encOutcomeHandle) return setMessage("❌ 没有密态赢家可解密");
    await decrypt();
  }, [encOutcomeHandle, decrypt]);

  // --- 标记过期的 CREATED 对局 ---
  const expireCreated = useCallback(
    async (matchId: string) => {
      if (!hasSigner || !hasContract) return setMessage("缺少合约或签名器");
      setIsProcessing(true);
      try {
        const write = getContract("write")!;
        const tx = await write.expireCreated(matchId);
        setMessage(`⏳ 等待交易确认... (${tx.hash.slice(0, 10)}...)`);
        
        // 使用轮询方式获取回执
        await pollReceipt(tx.hash, setMessage);
        
        setMessage("✅ 已标记为过期，可以取回押金");
        await statusRead.refetch();
      } catch (e) {
        setMessage(`❌ expireCreated 失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [hasSigner, hasContract, statusRead],
  );

  return {
    // data
    contractAddress: contract?.address,
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
    matchHistory,
    isLoadingHistory,

    // setters
    setCurrentMatchId,
    setSelectedMode,
    setSelectedStake,

    // actions
    playMove,
    getPendingMatchCount,
    getPendingMatches,
    getValidPendingMatchCount,
    resolveMatch,
    claim,
    decryptWinner,
    expireCreated,
    fetchMatchHistory, // 新增：手动刷新历史记录

    // manual refresh
    refreshStatus: refreshStatusRef.current.refresh,
  } as const;
};
