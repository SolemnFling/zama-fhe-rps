import { ethers, fhevm } from "hardhat";
import { parseEther } from "ethers";

/**
 * 自动匹配待定对局脚本
 *
 * 使用方法:
 * npx hardhat run scripts/auto_match.ts --network sepolia -- --mode=0 --stake=0 --move=0
 *
 * 参数说明:
 * --mode   对局模式 (0=练习, 1=真实下注)
 * --stake  押注金额 (ETH, 练习模式必须为 0)
 * --move   你的出手 (0=石头, 1=布, 2=剪刀)
 */

async function main() {
  // 支持两种方式传参: 命令行参数或环境变量
  const args = process.argv.slice(2);
  const modeArg = args.find(a => a.startsWith("--mode="));
  const stakeArg = args.find(a => a.startsWith("--stake="));
  const moveArg = args.find(a => a.startsWith("--move="));

  const mode = modeArg ? parseInt(modeArg.split("=")[1]) : (process.env.MODE ? parseInt(process.env.MODE) : undefined);
  const stakeStr = stakeArg ? stakeArg.split("=")[1] : process.env.STAKE;
  const move = moveArg ? parseInt(moveArg.split("=")[1]) : (process.env.MOVE ? parseInt(process.env.MOVE) : undefined);

  if (mode === undefined || stakeStr === undefined || move === undefined) {
    console.log("\n❌ 缺少参数!");
    console.log("\n使用方法 1 (完整命令):");
    console.log("  npx hardhat run scripts/auto_match.ts --network sepolia -- --mode=0 --stake=0 --move=0");
    console.log("\n使用方法 2 (环境变量 - 推荐):");
    console.log("  MODE=0 STAKE=0 MOVE=0 npm run rps:auto");
    console.log("  MODE=1 STAKE=0.001 MOVE=1 npm run rps:auto");
    console.log("\n参数说明:");
    console.log("  mode/MODE    对局模式 (0=练习, 1=真实下注)");
    console.log("  stake/STAKE  押注金额 (ETH, 练习模式必须为 0)");
    console.log("  move/MOVE    你的出手 (0=石头, 1=布, 2=剪刀)");
    console.log("\n示例:");
    console.log("  MODE=0 STAKE=0 MOVE=0 npm run rps:auto           # 练习模式, 出石头");
    console.log("  MODE=1 STAKE=0.001 MOVE=1 npm run rps:auto       # 真实模式, 押注 0.001 ETH, 出布");
    process.exit(1);
  }

  if (![0, 1].includes(mode)) {
    console.error("❌ mode 必须是 0 (练习) 或 1 (真实下注)");
    process.exit(1);
  }

  if (![0, 1, 2].includes(move)) {
    console.error("❌ move 必须是 0, 1, 或 2");
    process.exit(1);
  }

  const stake = parseEther(stakeStr);

  if (mode === 0 && stake !== 0n) {
    console.error("❌ 练习模式下 stake 必须为 0");
    process.exit(1);
  }

  const moveNames = ["石头", "布", "剪刀"];
  const modeNames = ["练习", "真实下注"];
  console.log("\n🎮 自动匹配对局脚本");
  console.log("===================\n");
  console.log(`模式: ${modeNames[mode]}`);
  console.log(`押注: ${ethers.formatEther(stake)} ETH`);
  console.log(`你的出手: ${move} (${moveNames[move]})\n`);

  // 加载钱包
  const { loadOrCreateWallet, topUpIfNeeded } = await import("./utils/wallet");
  const [deployer] = await ethers.getSigners();
  const playerB = loadOrCreateWallet(".wallet.match.json", ethers.provider);

  console.log(`玩家 B 地址: ${playerB.address}\n`);

  // 初始化 FHE
  await fhevm.initializeCLIApi();
  await fhevm.createInstance();

  // 获取合约
  const rpsAddr = process.env.PRIVATE_RPS_ADDR;
  if (!rpsAddr) {
    console.error("❌ 请设置环境变量 PRIVATE_RPS_ADDR");
    console.log("   export PRIVATE_RPS_ADDR=0x...");
    process.exit(1);
  }

  const rps = await ethers.getContractAt("PrivateRPS", rpsAddr, playerB);

  // 查询待匹配对局
  console.log("🔍 查询待匹配对局...");
  const [matchIds, total] = await rps.getPendingMatches(mode, stake, 0, 10);

  console.log(`   找到 ${total} 个待匹配对局`);

  if (total === 0n) {
    console.log("\n❌ 没有找到待匹配的对局!");
    console.log("\n建议:");
    console.log("1. 检查 mode 和 stake 参数是否正确");
    console.log("2. 在网页上创建一个对局");
    console.log("3. 或使用 match_web_game.ts 脚本手动指定 matchId");
    process.exit(1);
  }

  // 查找第一个未过期的对局
  let matchId: string | null = null;
  let validStatus: any = null;

  for (const id of matchIds) {
    console.log(`\n🔍 检查对局: ${id}`);
    const status = await rps.getStatus(id);
    const [state, playerA, playerBAddr, stakeAmount, deadline, matchMode] = status;

    // 检查是否过期
    const now = Math.floor(Date.now() / 1000);
    const deadlineNum = Number(deadline);

    if (deadlineNum <= now) {
      console.log(`   ⏰ 已过期 (deadline: ${new Date(deadlineNum * 1000).toLocaleString()})`);
      continue;
    }

    // 检查状态和玩家
    if (Number(state) !== 0) {
      console.log(`   ❌ 状态不正确: ${["已创建", "已加入", "已锁定", "已判定", "已过期"][Number(state)]}`);
      continue;
    }

    if (playerBAddr !== "0x0000000000000000000000000000000000000000") {
      console.log(`   ❌ 对局已满`);
      continue;
    }

    if (playerA === playerB.address) {
      console.log(`   ❌ 不能加入自己创建的对局`);
      continue;
    }

    // 找到有效对局
    matchId = id;
    validStatus = status;
    console.log(`   ✅ 对局有效!`);
    break;
  }

  if (!matchId || !validStatus) {
    console.log("\n❌ 没有找到可用的对局!");
    console.log("\n原因: 所有对局都已过期、已满或不可加入");
    console.log("\n建议:");
    console.log("1. 在网页上创建一个新对局");
    console.log("2. 或等待其他玩家创建对局");
    process.exit(1);
  }

  const [state, playerA, playerBAddr, stakeAmount, deadline, matchMode] = validStatus;

  console.log("\n📊 对局详情:");
  console.log(`   对局 ID: ${matchId}`);
  console.log(`   状态: ${["已创建", "已加入", "已锁定", "已判定", "已过期"][Number(state)]}`);
  console.log(`   玩家 A: ${playerA}`);
  console.log(`   玩家 B: ${playerBAddr}`);
  console.log(`   押注: ${ethers.formatEther(stakeAmount)} ETH`);
  console.log(`   截止: ${new Date(Number(deadline) * 1000).toLocaleString()}`);
  console.log(`   模式: ${matchMode === 0 ? "练习" : "真实"}\n`);

  if (Number(state) !== 0) {
    console.error(`❌ 对局状态错误! 必须是"已创建"才能加入`);
    console.error(`   当前状态: ${["已创建", "已加入", "已锁定", "已判定", "已过期"][Number(state)]}`);
    process.exit(1);
  }

  if (playerBAddr !== "0x0000000000000000000000000000000000000000") {
    console.error(`❌ 对局已满! 玩家 B: ${playerBAddr}`);
    process.exit(1);
  }

  if (playerA === playerB.address) {
    console.error(`❌ 不能加入自己创建的对局!`);
    process.exit(1);
  }

  // 充值 (如果需要)
  const needAmount = matchMode === 1 ? stakeAmount + parseEther("0.003") : parseEther("0.003");
  await topUpIfNeeded(deployer, playerB.address, ethers.provider, needAmount);

  // 加密出手
  console.log(`🔐 加密你的出手 (${moveNames[move]})...`);
  const enc = await fhevm.createEncryptedInput(rpsAddr, playerB.address).add8(move).encrypt();

  // 加入对局
  console.log("⚡ 加入对局...");
  console.log(`   💰 发送金额: ${ethers.formatEther(stakeAmount)} ETH (${stakeAmount.toString()} wei)`);
  const fee = await ethers.provider.getFeeData();
  const bump = (v?: bigint) => (v ? (v * 13n) / 10n : undefined);

  const tx = await rps.joinAndCommit(matchId, enc.handles[0], enc.inputProof, {
    value: matchMode === 1 ? stakeAmount : 0n,
    maxFeePerGas: bump(fee.maxFeePerGas),
    maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas),
  });

  console.log(`   交易哈希: ${tx.hash}`);
  console.log("   等待确认...");
  await tx.wait();

  console.log("\n✅ 成功加入对局并提交出手!\n");

  // 刷新状态
  const newStatus = await rps.getStatus(matchId);
  console.log("📊 新状态:");
  console.log(`   状态: ${["已创建", "已加入", "已锁定", "已判定", "已过期"][Number(newStatus[0])]}`);
  console.log(`   玩家 A: ${newStatus[1]}`);
  console.log(`   玩家 B: ${newStatus[2]}`);

  console.log("\n🎉 匹配成功!");
  console.log(`\n对局 ID: ${matchId}`);
  console.log("\n📋 下一步:");
  console.log("1. 回到网页，点击\"判定结果\"");
  console.log("2. 等待解密完成");
  console.log("3. 获胜方点击\"领取奖励\"");
}

main().catch(err => {
  console.error("\n❌ 错误:", err);
  process.exit(1);
});
