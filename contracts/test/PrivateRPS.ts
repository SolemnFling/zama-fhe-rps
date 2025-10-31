import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { PrivateRPS, PrivateRPS__factory } from "../types";

async function encMove(addr: string, user: string, move: number) {
  const input = fhevm.createEncryptedInput(addr, user);
  input.add8(move);
  const encrypted = await input.encrypt();
  return { handle: encrypted.handles[0], proof: encrypted.inputProof } as const;
}

describe("PrivateRPS (mock)", function () {
  let rps: PrivateRPS;
  let rpsAddr: string;
  const Mode = { PRACTICE: 0, WAGER: 1 } as const;

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite runs only on the FHEVM mock environment");
      this.skip();
    }

    const [deployer] = await ethers.getSigners();
    const factory = (await ethers.getContractFactory("PrivateRPS")) as PrivateRPS__factory;
    rps = await factory.deploy();
    rpsAddr = await rps.getAddress();

    // 确保 Coprocessor 初始化（mock 解密路径需要）
    await fhevm.assertCoprocessorInitialized(rps, "PrivateRPS");
  });

  describe("新接口: createAndCommit & joinAndCommit", function () {
    it("createAndCommit: 自动生成 matchId 并加入队列", async function () {
      const [a] = await ethers.getSigners();
      const now = await time.latest();
      const stake = ethers.parseEther("0.01");

      const aEnc = await encMove(rpsAddr, a.address, 0);
      const tx = await rps.connect(a).createAndCommit(aEnc.handle, aEnc.proof, Mode.WAGER, stake, now + 600, {
        value: stake,
      });
      const receipt = await tx.wait();

      // 从事件���取 matchId
      const createEvent = receipt!.logs.find((log: any) => {
        try {
          return rps.interface.parseLog(log)?.name === "MatchCreated";
        } catch {
          return false;
        }
      });
      expect(createEvent).to.not.be.undefined;
      const matchId = rps.interface.parseLog(createEvent!)!.args.matchId;

      // 验证对局状态
      const status = await rps.getStatus(matchId);
      expect(status[0]).to.eq(0); // State.CREATED
      expect(status[1]).to.eq(a.address);

      // 验证队列
      const count = await rps.getPendingMatchCount(Mode.WAGER, stake);
      expect(count).to.eq(1);

      const [matchIds] = await rps.getPendingMatches(Mode.WAGER, stake, 0, 10);
      expect(matchIds.length).to.eq(1);
      expect(matchIds[0]).to.eq(matchId);
    });

    it("joinAndCommit: 加入对局并自动从队列移除", async function () {
      const [a, b] = await ethers.getSigners();
      const now = await time.latest();
      const stake = ethers.parseEther("0.01");

      // A 创建对局
      const aEnc = await encMove(rpsAddr, a.address, 0);
      const txA = await rps.connect(a).createAndCommit(aEnc.handle, aEnc.proof, Mode.WAGER, stake, now + 600, {
        value: stake,
      });
      const receiptA = await txA.wait();
      const createEvent = receiptA!.logs.find((log: any) => {
        try {
          return rps.interface.parseLog(log)?.name === "MatchCreated";
        } catch {
          return false;
        }
      });
      const matchId = rps.interface.parseLog(createEvent!)!.args.matchId;

      // 验证队列有 1 个对局
      expect(await rps.getPendingMatchCount(Mode.WAGER, stake)).to.eq(1);

      // B 加入对局
      const bEnc = await encMove(rpsAddr, b.address, 2);
      await (await rps.connect(b).joinAndCommit(matchId, bEnc.handle, bEnc.proof, { value: stake })).wait();

      // 验证对局状态
      const status = await rps.getStatus(matchId);
      expect(status[0]).to.eq(2); // State.LOCKED
      expect(status[1]).to.eq(a.address);
      expect(status[2]).to.eq(b.address);

      // 验证队列已清空
      expect(await rps.getPendingMatchCount(Mode.WAGER, stake)).to.eq(0);
    });

    it("完整流程: A 创建 → B 加入 → resolve → claim", async function () {
      const signers = await ethers.getSigners();
      const owner = signers[0]; // beforeEach 中 deployer 是第一个 signer
      const a = signers[1];
      const b = signers[2];
      const now = await time.latest();
      const stake = ethers.parseEther("0.01");

      // A 创建对局 (Rock)
      const aEnc = await encMove(rpsAddr, a.address, 0);
      const txA = await rps.connect(a).createAndCommit(aEnc.handle, aEnc.proof, Mode.WAGER, stake, now + 600, {
        value: stake,
      });
      const receiptA = await txA.wait();
      const createEvent = receiptA!.logs.find((log: any) => {
        try {
          return rps.interface.parseLog(log)?.name === "MatchCreated";
        } catch {
          return false;
        }
      });
      const matchId = rps.interface.parseLog(createEvent!)!.args.matchId;

      // B 加入对局 (Scissors)
      const bEnc = await encMove(rpsAddr, b.address, 2);
      await (await rps.connect(b).joinAndCommit(matchId, bEnc.handle, bEnc.proof, { value: stake })).wait();

      // Resolve
      await (await rps.resolve(matchId)).wait();

      // 解密并回写 (owner 是第一个 signer)
      const enc = await rps.getEncryptedOutcome(matchId);
      const clear = await fhevm.userDecryptEaddress(enc, rpsAddr, a);
      expect(clear).to.eq(a.address); // A 应该胜出
      await (await rps.connect(owner).finalizeWinner(matchId, clear)).wait();

      // Claim
      const balBefore = await ethers.provider.getBalance(a.address);
      const tx = await rps.connect(a).claim(matchId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice!;
      const balAfter = await ethers.provider.getBalance(a.address);

      // A 应该收到 2*stake (扣除 gas)
      const netGain = balAfter - balBefore + gasUsed;
      expect(netGain).to.be.closeTo(stake * 2n, ethers.parseEther("0.0001"));
    });

    it("队列查询: getPendingMatches 分页", async function () {
      const [a, b, c] = await ethers.getSigners();
      const now = await time.latest();
      const stake = ethers.parseEther("0.01");

      // 创建 3 个对局
      const matchIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const user = [a, b, c][i];
        const enc = await encMove(rpsAddr, user.address, i);
        const tx = await rps.connect(user).createAndCommit(enc.handle, enc.proof, Mode.WAGER, stake, now + 600, {
          value: stake,
        });
        const receipt = await tx.wait();
        const createEvent = receipt!.logs.find((log: any) => {
          try {
            return rps.interface.parseLog(log)?.name === "MatchCreated";
          } catch {
            return false;
          }
        });
        matchIds.push(rps.interface.parseLog(createEvent!)!.args.matchId);
      }

      // 验证队列总数
      const total = await rps.getPendingMatchCount(Mode.WAGER, stake);
      expect(total).to.eq(3);

      // 测试分页
      const [page1, total1] = await rps.getPendingMatches(Mode.WAGER, stake, 0, 2);
      expect(total1).to.eq(3);
      expect(page1.length).to.eq(2);

      const [page2, total2] = await rps.getPendingMatches(Mode.WAGER, stake, 2, 2);
      expect(total2).to.eq(3);
      expect(page2.length).to.eq(1);
    });

    it("防止自己加入自己创建的对局", async function () {
      const [a] = await ethers.getSigners();
      const now = await time.latest();
      const stake = ethers.parseEther("0.01");

      // A 创建对局
      const aEnc = await encMove(rpsAddr, a.address, 0);
      const tx = await rps.connect(a).createAndCommit(aEnc.handle, aEnc.proof, Mode.WAGER, stake, now + 600, {
        value: stake,
      });
      const receipt = await tx.wait();
      const createEvent = receipt!.logs.find((log: any) => {
        try {
          return rps.interface.parseLog(log)?.name === "MatchCreated";
        } catch {
          return false;
        }
      });
      const matchId = rps.interface.parseLog(createEvent!)!.args.matchId;

      // A 尝试加入自己的对局
      const aEnc2 = await encMove(rpsAddr, a.address, 1);
      await expect(rps.connect(a).joinAndCommit(matchId, aEnc2.handle, aEnc2.proof, { value: stake })).to.be.reverted;
    });
  });
});
