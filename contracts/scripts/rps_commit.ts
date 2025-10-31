import { ethers, fhevm } from "hardhat";

// 模拟前端匹配逻辑: A=R(0), B=S(2) → A 胜并 claim
// 前端负责查询和决策,合约负责存储和验证
async function main() {
  const [deployer] = await ethers.getSigners();
  const rpsAddr = process.env.PRIVATE_RPS_ADDR || "0x59D31538592D136D9Ac4b5dB2433b07E1330607D";
  const rps = await ethers.getContractAt("PrivateRPS", rpsAddr, deployer);

  await fhevm.initializeCLIApi();
  await fhevm.createInstance();
  const now = Math.floor(Date.now() / 1000);
  const stakeArg = process.argv.find(a => a.startsWith("--stake"));
  const stakeEth = stakeArg ? stakeArg.split("=")[1] : "0.001";
  const stake = ethers.parseEther(stakeEth);

  console.log("[FRONTEND MATCH MODE] stake:", stakeEth, "ETH");

  const fee = await ethers.provider.getFeeData();
  const bump = (v?: bigint) => (v ? (v * 13n) / 10n : undefined);

  // ==================== 步骤 1: A 尝试匹配 ====================
  console.log("\n[1/5] A 查询匹配池并决策...");

  // 前端查询: 是否有等待的对局
  const pendingBefore = await rps.getPendingMatchCount(1, stake);
  console.log(`   当前 ${stakeEth} ETH 队列中有 ${pendingBefore} 个等待对局`);

  let matchIdA: string;

  if (pendingBefore > 0) {
    // 有等待对局,获取第一个
    const [matchIds] = await rps.getPendingMatches(1, stake, 0, 1);
    matchIdA = matchIds[0];
    console.log(`   ✅ 找到等待对局: ${matchIdA}`);
    console.log(`   → A 决定: 加入对局`);

    // A 加入对局
    const aEnc = await fhevm.createEncryptedInput(rpsAddr, deployer.address).add8(0).encrypt();
    let tx = await rps.joinAndCommit(matchIdA as any, aEnc.handles[0], aEnc.inputProof, {
      value: stake,
      maxFeePerGas: bump(fee.maxFeePerGas),
      maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas),
    });
    await tx.wait();
    console.log(`   ✅ A 加入成功`);
  } else {
    console.log(`   ❌ 没有等待对局`);
    console.log(`   → A 决定: 创建新对局`);

    // A 创建对局
    const aEnc = await fhevm.createEncryptedInput(rpsAddr, deployer.address).add8(0).encrypt();
    let tx = await rps.createAndCommit(
      aEnc.handles[0],
      aEnc.inputProof,
      1, // WAGER
      stake,
      now + 600,
      {
        value: stake,
        maxFeePerGas: bump(fee.maxFeePerGas),
        maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas),
      }
    );
    const receipt = await tx.wait();

    // 从事件提取 matchId
    const createEvent = receipt!.logs.find((log: any) => {
      try {
        return rps.interface.parseLog(log)?.name === "MatchCreated";
      } catch {
        return false;
      }
    });
    matchIdA = rps.interface.parseLog(createEvent!)!.args.matchId;
    console.log(`   ✅ A 创建对局: ${matchIdA}`);
  }

  await new Promise(r => setTimeout(r, 2000));

  // ==================== 步骤 2: B 尝试匹配 (模拟10秒超时) ====================
  console.log("\n[2/5] B 查询匹配池并决策 (模拟10秒超时逻辑)...");

  const { loadOrCreateWallet, topUpIfNeeded } = await import("./utils/wallet");
  const bWallet = loadOrCreateWallet(".wallet.b.json", ethers.provider);
  const need = stake + ethers.parseEther("0.003");
  await topUpIfNeeded(deployer, bWallet.address, ethers.provider, need);
  const rpsAsB = rps.connect(bWallet);

  // 前端轮询匹配 (最多10秒)
  const startTime = Date.now();
  const timeout = 10000; // 10秒
  let matchIdB: string | null = null;

  console.log(`   ⏳ 开始查询,超时时间: ${timeout / 1000}秒`);

  while (Date.now() - startTime < timeout) {
    const pendingCount = await rpsAsB.getPendingMatchCount(1, stake);

    if (pendingCount > 0) {
      // 找到等待对局
      const [matchIds] = await rpsAsB.getPendingMatches(1, stake, 0, 1);
      matchIdB = matchIds[0];
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ✅ 找到等待对局: ${matchIdB} (耗时: ${elapsed}秒)`);
      console.log(`   → B 决定: 加入对局`);
      break;
    }

    // 等待1秒后重试
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!matchIdB) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ❌ 超时 (${elapsed}秒),未找到对局`);
    console.log(`   → B 决定: 创建新对局`);
  }

  // B 执行决策
  const bEnc = await fhevm.createEncryptedInput(rpsAddr, bWallet.address).add8(2).encrypt();

  if (matchIdB) {
    // 加入对局
    let tx = await rpsAsB.joinAndCommit(matchIdB as any, bEnc.handles[0], bEnc.inputProof, {
      value: stake,
      maxFeePerGas: bump(fee.maxFeePerGas),
      maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas),
    });
    await tx.wait();
    console.log(`   ✅ B 加入成功`);
    console.log(`   验证匹配: ${matchIdA === matchIdB ? "✅ 匹配成功!" : "❌ ID不一致"}`);
  } else {
    // 创建新对局
    let tx = await rpsAsB.createAndCommit(bEnc.handles[0], bEnc.inputProof, 1, stake, now + 600, {
      value: stake,
      maxFeePerGas: bump(fee.maxFeePerGas),
      maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas),
    });
    const receipt = await tx.wait();
    const createEvent = receipt!.logs.find((log: any) => {
      try {
        return rpsAsB.interface.parseLog(log)?.name === "MatchCreated";
      } catch {
        return false;
      }
    });
    matchIdB = rpsAsB.interface.parseLog(createEvent!)!.args.matchId;
    console.log(`   ✅ B 创建新对局: ${matchIdB}`);
  }

  await new Promise(r => setTimeout(r, 2000));

  const matchId = matchIdB || matchIdA;

  // 检查对局状态
  const status = await rps.getStatus(matchId as any);
  console.log(`\n[INFO] 对局状态: ${["CREATED", "JOINED", "LOCKED", "RESOLVED", "EXPIRED"][status.state]}`);

  if (status.state !== 2) {
    // 不是 LOCKED
    console.log("⚠️  对局未完成,无法继续 resolve");
    return;
  }

  // ==================== 步骤 3: 判定并解密 ====================
  console.log("\n[3/5] 触发判定并解密赢家...");
  let tx = await rps.resolve(matchId as any, {
    maxFeePerGas: bump(fee.maxFeePerGas),
    maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas),
  });
  await tx.wait();

  const enc = await rps.getEncryptedOutcome(matchId as any);
  const clear = await fhevm.userDecryptEaddress(enc, rpsAddr, deployer);
  console.log("🔓 Winner (本地解密):", clear);
  console.log("   Expected:", deployer.address, "(A 出石头胜剪刀)");

  // 将赢家明文回写链上
  tx = await rps.finalizeWinner(matchId as any, clear as any, {
    maxFeePerGas: bump(fee.maxFeePerGas),
    maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas),
  });
  await tx.wait();
  console.log("✅ 赢家已上链");

  // ==================== 步骤 4: 领取奖励 ====================
  console.log("\n[4/5] 获胜方领取奖励...");
  const balBefore = await ethers.provider.getBalance(deployer.address);

  tx = await rps.claim(matchId as any, {
    maxFeePerGas: bump(fee.maxFeePerGas),
    maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas),
  });
  const claimReceipt = await tx.wait();
  const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;

  const balAfter = await ethers.provider.getBalance(deployer.address);
  const netGain = balAfter - balBefore + gasUsed;

  console.log("✅ Claim 完成");
  console.log("   实际收益:", ethers.formatEther(netGain), "ETH");
  console.log("   理论收益:", ethers.formatEther(stake * 2n), "ETH (无手续费)");

  console.log("\n🎉 游戏结束!");
  console.log("   玩家签名: 2 次");
  console.log("   匹配逻辑: ✅ 前端负责查询和决策");
  console.log("   ID 生成: ✅ 合约自动生成");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
