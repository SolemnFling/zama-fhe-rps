#!/bin/bash

# PrivateRPS 部署脚本
# 使用方法: ./deploy_and_sync.sh [network]
# 示例: ./deploy_and_sync.sh sepolia

set -e

NETWORK=${1:-localhost}

echo "🚀 开始部署 PrivateRPS 合约到 $NETWORK..."

# 1. 编译合约
echo "📦 编译合约..."
npm run compile

# 2. 部署合约
echo "🔨 部署到 $NETWORK..."
if [ "$NETWORK" = "localhost" ]; then
  npm run deploy:localhost
elif [ "$NETWORK" = "sepolia" ]; then
  npm run deploy:sepolia
else
  echo "❌ 不支持的网络: $NETWORK"
  echo "支持的网络: localhost, sepolia"
  exit 1
fi

# 3. 获取合约地址
echo "📝 获取合约地址..."
DEPLOYMENT_FILE="deployments/$NETWORK/PrivateRPS.json"

if [ ! -f "$DEPLOYMENT_FILE" ]; then
  echo "❌ 部署文件不存在: $DEPLOYMENT_FILE"
  exit 1
fi

CONTRACT_ADDRESS=$(node -e "console.log(require('./$DEPLOYMENT_FILE').address)")
echo "✅ 合约地址: $CONTRACT_ADDRESS"

# 4. 同步 ABI 到前端 (如果前端目录存在)
FRONTEND_DIR="../apps/web/packages/nextjs"
if [ -d "$FRONTEND_DIR" ]; then
  echo "🔄 同步 ABI 到前端..."

  # 创建目标目录
  mkdir -p "$FRONTEND_DIR/contracts"

  # 复制 deployments 目录
  cp -r deployments "$FRONTEND_DIR/contracts/"

  echo "✅ ABI 同步完成"
else
  echo "⚠️  前端目录不存在，跳过 ABI 同步"
fi

# 5. 显示部署信息
echo ""
echo "=========================================="
echo "🎉 部署成功!"
echo "=========================================="
echo "网络: $NETWORK"
echo "合约: PrivateRPS"
echo "地址: $CONTRACT_ADDRESS"
echo "=========================================="
echo ""
echo "📋 下一步:"
echo "1. 如果是 Sepolia，运行验证: npm run verify:sepolia"
echo "2. 设置环境变量: export PRIVATE_RPS_ADDR=$CONTRACT_ADDRESS"
echo "3. 运行测试: npm run rps:commit -- --stake=0.001"
echo ""

# 6. 如果是 Sepolia，提示验证
if [ "$NETWORK" = "sepolia" ]; then
  echo "🔍 提示: 部署到 Sepolia 后，建议验证合约:"
  echo "   npm run verify:sepolia"
  echo ""
fi
