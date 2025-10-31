#!/bin/bash
# 部署合约到 Sepolia 并同步到前端
# 使用方法: ./deploy_and_update.sh

set -e  # 出错时停止

echo "🚀 开始部署流程..."

# 1. 进入合约目录
cd contracts

# 2. 部署合约到 Sepolia
echo ""
echo "📝 部署合约到 Sepolia..."
npm run deploy:sepolia

# 3. 同步合约到前端
echo ""
echo "🔄 同步合约 ABI 到前端..."
npx tsx scripts/syncContracts.ts

# 4. 返回根目录
cd ..

# 5. 提交更改
echo ""
echo "💾 提交更改到 Git..."
git add contracts/deployments/sepolia/
git add apps/web/packages/nextjs/contracts/deployedContracts.ts
git commit -m "chore: update contract deployment $(date +%Y-%m-%d_%H:%M:%S)"

echo ""
echo "✅ 完成！现在可以 git push，Vercel 会自动重新部署前端"
echo ""
echo "📋 后续步骤:"
echo "  1. git push origin main"
echo "  2. Vercel 会自动检测并重新部署"
echo "  3. 访问你的 Vercel URL 测试新合约"
