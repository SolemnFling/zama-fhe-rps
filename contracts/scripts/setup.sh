#!/bin/bash

# 🚀 快速设置新合约地址

NEW_ADDR="0xb65fEDcbDc25864bdb5AFc74dE4eF28fd24B04BD"

echo "🎮 PrivateRPS 快速设置脚本"
echo "=========================="
echo ""
echo "新合约地址: $NEW_ADDR"
echo ""

# 1. 设置环境变量
echo "1️⃣ 设置环境变量..."
export PRIVATE_RPS_ADDR=$NEW_ADDR
echo "   ✅ PRIVATE_RPS_ADDR=$PRIVATE_RPS_ADDR"

# 2. 添加到 shell 配置文件（持久化）
SHELL_RC=""
if [ -f ~/.zshrc ]; then
    SHELL_RC=~/.zshrc
elif [ -f ~/.bashrc ]; then
    SHELL_RC=~/.bashrc
fi

if [ -n "$SHELL_RC" ]; then
    if ! grep -q "PRIVATE_RPS_ADDR=$NEW_ADDR" "$SHELL_RC"; then
        echo "" >> "$SHELL_RC"
        echo "# PrivateRPS 合约地址" >> "$SHELL_RC"
        echo "export PRIVATE_RPS_ADDR=$NEW_ADDR" >> "$SHELL_RC"
        echo "   ✅ 已添加到 $SHELL_RC"
    else
        echo "   ℹ️  $SHELL_RC 中已存在该配置"
    fi
fi

# 3. 验证合约地址
echo ""
echo "2️⃣ 验证合约..."
npx hardhat console --network sepolia << EOF > /tmp/contract_check.txt 2>&1
const rps = await ethers.getContractAt("PrivateRPS", "$NEW_ADDR");
console.log("Owner:", await rps.owner());
console.log("验证成功!");
process.exit(0);
EOF

if grep -q "验证成功" /tmp/contract_check.txt; then
    echo "   ✅ 合约验证成功"
else
    echo "   ⚠️  合约验证失败，请检查网络连接"
fi

# 4. 显示使用说明
echo ""
echo "3️⃣ 使用说明"
echo "=========================="
echo ""
echo "📍 当前会话已设置环境变量（临时）"
echo "   echo \$PRIVATE_RPS_ADDR  # 查看当前值"
echo ""
echo "🔄 重启终端后自动加载（持久化）"
if [ -n "$SHELL_RC" ]; then
    echo "   source $SHELL_RC  # 或重启终端"
fi
echo ""
echo "🎮 运行脚本示例:"
echo "   MODE=0 STAKE=0 MOVE=0 npm run rps:auto        # 练习模式"
echo "   MODE=1 STAKE=0.001 MOVE=1 npm run rps:auto    # 真实模式"
echo ""
echo "🔍 查询对局示例:"
echo "   npx hardhat console --network sepolia"
echo "   > const rps = await ethers.getContractAt(\"PrivateRPS\", \"$NEW_ADDR\");"
echo "   > await rps.getPendingMatchCount(1, ethers.parseEther(\"0.001\"));"
echo ""
echo "✅ 设置完成!"
