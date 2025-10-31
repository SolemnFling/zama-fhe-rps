import { ethers } from "ethers";
import fs from "fs";
import path from "path";

export type StoredWallet = { address: string; privateKey: string };

/**
 * 从本地文件加载或创建钱包。默认写入 JSON：{ address, privateKey }
 */
export function loadOrCreateWallet(fileRelativePath: string, provider: ethers.Provider) {
  const file = path.resolve(process.cwd(), fileRelativePath);
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as StoredWallet;
    const w = new ethers.Wallet(data.privateKey, provider);
    if (w.address.toLowerCase() !== data.address.toLowerCase()) {
      throw new Error(`钱包文件地址与私钥不匹配：${data.address} != ${w.address}`);
    }
    return w;
  }
  const w = ethers.Wallet.createRandom().connect(provider);
  const payload: StoredWallet = { address: w.address, privateKey: w.privateKey };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: "utf8" });
  return w;
}

/**
 * 保证钱包余额达到目标（不足时从 funder 转账补足）。
 */
export async function topUpIfNeeded(
  funder: ethers.Signer,
  recipient: string,
  provider: ethers.Provider,
  targetWei: bigint,
) {
  const bal = await provider.getBalance(recipient);
  if (bal >= targetWei) return;
  const diff = targetWei - bal;
  const tx = await funder.sendTransaction({ to: recipient, value: diff });
  await tx.wait();
}
