export type Language = "en" | "zh";

export const translations = {
  en: {
    // Connection status
    connected: "Connected",
    connecting: "Connecting...",
    disconnected: "Connect Wallet",
    error: "Error",
    
    // Game states
    created: "Waiting",
    joined: "Joined",
    resolved: "Resolved",
    expired: "Expired",
    
    // Match results
    youWon: "You Won",
    youLost: "You Lost",
    draw: "Draw",
    waitingForOpponent: "Waiting for Opponent",
    matchExpired: "Expired",
    
    // Game modes
    practiceMode: "Practice Mode",
    wagerMode: "Wager Mode",
    free: "Free",
    
    // Actions
    commitMove: "Commit Move",
    resolve: "Resolve",
    claim: "Claim Reward",
    markExpired: "Mark as Expired",
    refund: "Refund",
    
    // Moves
    rock: "Rock",
    paper: "Paper",
    scissors: "Scissors",
    
    // Time
    expiresIn: (time: string) => `Expires in ${time}`,
    expiredAgo: (time: string) => `Expired ${time} ago`,
    seconds: "s",
    minutes: "m",
    hours: "h",
    days: "d",
    
    // Match history
    matchHistory: "History",
    noMatches: "No matches yet",
    matchPool: "Match Pool",
    matches: "matches",
    refresh: "Refresh",
    loading: "Loading...",
    
    // Titles
    gameTitle: "Private Rock-Paper-Scissors",
    selectMode: "Game Mode",
    yourMove: "Your Move",
    matchStatus: "Match Status",
    
    // Players
    playerA: "Player A",
    playerB: "Player B",
    winner: "Winner",
    status: "Status",
    
    // Messages
    connectWallet: "Please connect wallet first",
    
    // Instructions
    instruction1: "✅ <strong>Select mode and amount</strong> - Practice mode is free, wager mode requires stake",
    instruction2: "✅ <strong>Make your move</strong> - System searches for match (10s max), creates new if not found",
    instruction3: "✅ <strong>Wait for opponent</strong> - After creating match, wait for another player to join",
    instruction4: "✅ <strong>Resolve result</strong> - After both commit, click \"Resolve\" to compute winner",
    instruction5: "✅ <strong>Claim reward</strong> - Winner claims prize pool, draw refunds stakes",
  },
  zh: {
    // Connection status
    connected: "已连接",
    connecting: "连接中...",
    disconnected: "连接钱包",
    error: "错误",
    
    // Game states
    created: "等待中",
    joined: "已加入",
    resolved: "已判定",
    expired: "已过期",
    
    // Match results
    youWon: "你赢了",
    youLost: "你输了",
    draw: "平局",
    waitingForOpponent: "等待对手",
    matchExpired: "已过期",
    
    // Game modes
    practiceMode: "练习模式",
    wagerMode: "真金模式",
    free: "免费",
    
    // Actions
    commitMove: "提交出手",
    resolve: "判定结果",
    claim: "领取奖励",
    markExpired: "标记过期",
    refund: "取回押金",
    
    // Moves
    rock: "石头",
    paper: "布",
    scissors: "剪刀",
    
    // Time
    expiresIn: (time: string) => `${time}后过期`,
    expiredAgo: (time: string) => `${time}前过期`,
    seconds: "秒",
    minutes: "分钟",
    hours: "小时",
    days: "天",
    
    // Match history
    matchHistory: "历史",
    noMatches: "暂无对局记录",
    matchPool: "匹配池",
    matches: "个对局",
    refresh: "刷新",
    loading: "加载中...",
    
    // Titles
    gameTitle: "私密石头剪刀布",
    selectMode: "游戏模式",
    yourMove: "选择出手",
    matchStatus: "对局状态",
    
    // Players
    playerA: "玩家A",
    playerB: "玩家B",
    winner: "获胜者",
    status: "状态",
    
    // Messages
    connectWallet: "请先连接钱包",
    
    // Instructions
    instruction1: "✅ <strong>选择模式和金额</strong> - 练习模式免费，真实模式需要下注",
    instruction2: "✅ <strong>点击出手</strong> - 系统自动查找匹配（最多10秒），找不到则创建新对局",
    instruction3: "✅ <strong>等待对手</strong> - 对局创建后，等待其他玩家加入",
    instruction4: '✅ <strong>判定结果</strong> - 双方出手后，点击"判定结果"触发智能合约计算',
    instruction5: "✅ <strong>领取奖励</strong> - 赢家可领取奖池，平局则各自退回押金",
  },
};

export function getBrowserLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const lang = navigator.language.toLowerCase();
  return lang.startsWith("zh") ? "zh" : "en";
}
