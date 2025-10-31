#!/bin/bash

# 禁用代理并运行脚本

echo "🔧 禁用代理运行 rps:auto..."
echo ""

env -u http_proxy \
    -u https_proxy \
    -u HTTP_PROXY \
    -u HTTPS_PROXY \
    -u ALL_PROXY \
    -u all_proxy \
    PRIVATE_RPS_ADDR=0xb65fEDcbDc25864bdb5AFc74dE4eF28fd24B04BD \
    MODE=1 \
    STAKE=0.001 \
    MOVE=1 \
    npm run rps:auto
