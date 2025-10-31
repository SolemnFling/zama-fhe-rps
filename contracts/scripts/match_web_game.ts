import { ethers, fhevm } from "hardhat";
import { parseEther } from "ethers";

/**
 * 网页对局匹配脚本
 *
 * 使用方法:
 * 1. 在网页上创建对局（点击出手）
 * 2. 复制对局 matchId
 * 3. 运行此脚本: npx hardhat run scripts/match_web_game.ts --network sepolia
 * 4. 按提示输入 matchId 和出手 (0=石头, 1=布, 2=剪刀)
 */

async function main() {
  const args = process.argv.slice(2);
  const matchIdIndex = args.findIndex(a => a.startsWith("--matchId="));
  const moveIndex = args.findIndex(a => a.startsWith("--move="));

  if (matchIdIndex === -1 || moveIndex === -1) {
    console.log("\n❌ 缺少参数!");
    console.log("\n使用方法:");
    console.log("  npx hardhat run scripts/match_web_game.ts --network sepolia -- --matchId=0x... --move=0");
    console.log("\n参数说明:");
    console.log("  --matchId  网页上创建的对局 ID (完整的 bytes32)");
    console.log("  --move     你的出手 (0=石头, 1=布, 2=剪刀)");
    console.log("\n示例:");
    console.log("  --matchId=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    console.log("  --move=0");
    process.exit(1);
  }

  const matchId = args[matchIdIndex].split("=")[1];
  const move = parseInt(args[moveIndex].split("=")[1]);

  if (!/^0x[0-9a-fA-F]{64}$/.test(matchId)) {
    console.error("❌ matchId 格式错误! 应该是 0x 开头的 64 位十六进制");
    process.exit(1);
  }

  if (![0, 1, 2].includes(move)) {
    console.error("❌ move 必须是 0, 1, 或 2");
    process.exit(1);
  }

  const moveNames = ["石头", "布", "剪刀"];
  console.log("\n🎮 网页对局匹配脚本");
  console.log("===================\n");
  console.log(`对局 ID: ${matchId}`);
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

  // 查询对局状态
  console.log("📊 查询对局状态...");
  const status = await rps.getStatus(matchId);
  const [state, playerA, playerBAddr, stake, deadline, mode] = status;

  console.log(`   状态: ${["已创建", "已加入", "已锁定", "已判定", "已过期"][state]}`);
  console.log(`   玩家 A: ${playerA}`);
  console.log(`   玩家 B: ${playerBAddr}`);
  console.log(`   押注: ${ethers.formatEther(stake)} ETH`);
  console.log(`   模式: ${mode === 0 ? "练习" : "真实"}\n`);

  if (state !== 0) {
    console.error(`❌ 对局状态错误! 必须是"已创建"才能加入`);
    console.error(`   当前状态: ${["已创建", "已加入", "已锁定", "已判定", "已过期"][state]}`);
    process.exit(1);
  }

  if (playerBAddr !== "0x0000000000000000000000000000000000000000") {
    console.error(`❌ 对局已满! 玩家 B: ${playerBAddr}`);
    process.exit(1);
  }

  // 充值 (如果需要)
  const needAmount = mode === 1 ? stake + parseEther("0.003") : parseEther("0.003");
  await topUpIfNeeded(deployer, playerB.address, ethers.provider, needAmount);

  // 加密出手
  console.log(`🔐 加密你的出手 (${moveNames[move]})...`);
  const enc = await fhevm.createEncryptedInput(rpsAddr, playerB.address).add8(move).encrypt();

  // 加入对局
  console.log("⚡ 加入对局...");
  const fee = await ethers.provider.getFeeData();
  const bump = (v?: bigint) => (v ? (v * 13n) / 10n : undefined);

  const tx = await rps.joinAndCommit(matchId, enc.handles[0], enc.inputProof, {
    value: mode === 1 ? stake : 0n,
    maxFeePerGas: bump(fee.maxFeePerGas),
    maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas),
  });

  console.log(`   交易哈希: ${tx.hash}`);
  await tx.wait();

  console.log("\n✅ 成功加入对局并提交出手!\n");

  // 刷新状态
  const newStatus = await rps.getStatus(matchId);
  console.log("📊 新状态:");
  console.log(`   状态: ${["已创建", "已加入", "已锁定", "已判定", "已过期"][newStatus[0]]}`);
  console.log(`   玩家 A: ${newStatus[1]}`);
  console.log(`   玩家 B: ${newStatus[2]}`);

  console.log("\n🎉 匹配成功!");
  console.log("\n📋 下一步:");
  console.log("1. 回到网页，点击`判定结果`");
  console.log("2. 等待解密完成");
  console.log("3. 获胜方点击`领取奖励`");
}

main().catch(err => {
  console.error("\n❌ 错误:", err);
  process.exit(1);
});
