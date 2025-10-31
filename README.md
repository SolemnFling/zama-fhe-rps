# 🎮 Private Rock-Paper-Scissors on FHEVM

A fully homomorphic encryption (FHE) based Rock-Paper-Scissors game built on Zama's FHEVM protocol. Players can compete with **complete privacy** - moves remain encrypted on-chain until both players commit, ensuring fair gameplay without revealing strategies.

## 🔐 Why Privacy Matters

Traditional on-chain games expose all player actions publicly, allowing:
- ❌ Opponents to analyze your play patterns
- ❌ Bots to observe and exploit your strategies
- ❌ Historical moves to reveal behavioral tendencies

**Our Solution with FHEVM:**
- ✅ **Every move is encrypted** (euint8) before going on-chain
- ✅ **No one can see your play history** - not even blockchain explorers
- ✅ **Pattern analysis is impossible** - encrypted data reveals nothing
- ✅ **Fair gameplay guaranteed** - winner computed in FHE without revealing moves
- ✅ **Strategy protection** - your playing style remains completely private

This is the first Rock-Paper-Scissors game where **your moves are truly yours** - no one can study your habits or predict your next play!

## 🌟 Features

### Privacy-Preserving Gameplay
- **Encrypted Moves**: Player choices (rock/paper/scissors) are encrypted using FHEVM before being sent on-chain
- **Protected History**: Your entire play history remains encrypted - no pattern analysis possible
- **Fair Resolution**: No player can see opponent's move until both have committed
- **On-chain Logic**: All game logic executes in FHE, maintaining privacy throughout

### Two Game Modes
1. **Practice Mode** (Free)
   - Play without stakes to test the system
   - Perfect for learning FHE gaming mechanics

2. **Wager Mode** (0.001 ETH)
   - Real ETH stakes for competitive play
   - Winner takes the pot
   - Automatic timeout and refund system

### Smart Contract Features
- Automatic matchmaking queue
- Timeout protection (15 minutes)
- Winner claim mechanism
- Expired match refunds
- Gas-optimized FHE operations

## 🏗️ Architecture

### Smart Contract (`contracts/contracts/PrivateRPS.sol`)
```
Create Match → Encrypt Move A → Store on-chain
                                    ↓
Join Match ← Find Pending ← Encrypt Move B
                                    ↓
Both Committed → Resolve (FHE compute winner) → Claim Prize
```

**Key Functions:**
- `createAndCommit()` - Create match with encrypted move
- `joinAndCommit()` - Join existing match with encrypted move
- `resolve()` - Compute winner using FHE
- `claim()` - Winner claims prize
- `expireCreated()` - Mark expired matches for refund

### Frontend (`apps/web/packages/nextjs/`)
- **Tech Stack**: Next.js 14, React, TypeScript, TailwindCSS
- **Web3**: wagmi, viem, ethers.js v6
- **FHE**: fhevm-sdk for client-side encryption
- **Features**: Real-time match status, history tracking, responsive UI

## 🚀 Quick Start

### Prerequisites
```bash
Node.js >= 18
pnpm >= 8
MetaMask or compatible wallet
Sepolia testnet ETH
```

### Installation

1. **Clone and Install**
```bash
git clone https://github.com/SolemnFling/zama-fhe-rps.git
cd zama-fhe-rps
```

2. **Install Contracts Dependencies**
```bash
cd contracts
npm install
```

3. **Install Frontend Dependencies**
```bash
cd ../apps/web
pnpm install
```

### Deployment

#### Deploy Smart Contract to Sepolia

1. Set your private key:
```bash
cd contracts
npx hardhat vars set PRIVATE_KEY
# Enter your private key when prompted
```

2. Deploy:
```bash
npm run deploy:sepolia
```

3. Sync contract to frontend:
```bash
npx tsx scripts/syncContracts.ts
```

#### Run Frontend

```bash
cd apps/web
pnpm start
```

Visit `http://localhost:3000/rps`

## 🎯 How to Play

### Step 1: Connect Wallet
- Click "Connect Wallet" in the top-right
- Switch to Sepolia testnet
- Ensure you have some test ETH

### Step 2: Choose Mode
- **Practice Mode**: Free play, no stakes
- **Wager Mode**: 0.001 ETH stake

### Step 3: Make Your Move
- Click Rock ✊, Paper ✋, or Scissors ✌️
- Your move is encrypted client-side using FHEVM SDK
- System searches for existing matches (10 seconds)
  - **Match found**: You join instantly
  - **No match**: Creates new match, waits for opponent

### Step 4: Wait for Resolution
- Once both players commit, either player can click "Resolve"
- Smart contract computes winner using FHE
- Result is revealed (winner address)

### Step 5: Claim Prize
- Winner clicks "Claim" to receive the pot
- Loser sees match result in history

### Timeout Protection
- If no opponent joins within 15 minutes:
  - Click "Mark Expired" 
  - Then click "Claim Refund" to get your stake back

## 📊 Contract Details

### Deployed on Sepolia
- **Network**: Sepolia Testnet (Chain ID: 11155111)
- **Contract**: `PrivateRPS`
- **Address**: Check `contracts/deployments/sepolia/PrivateRPS.json`

### Game States
```
0: CREATED   - Match created, waiting for opponent
1: JOINED    - Both players committed
2: LOCKED    - (Reserved for future use)
3: RESOLVED  - Winner determined
4: EXPIRED   - Timeout occurred
```

### Security Features
- ✅ Encrypted moves (euint8) - completely invisible on-chain
- ✅ Historical privacy - all past moves remain encrypted forever
- ✅ Pattern-proof design - impossible to analyze play style
- ✅ Commit-reveal pattern via FHE
- ✅ Deadline enforcement
- ✅ Reentrancy protection
- ✅ Access control

## 🛠️ Technical Implementation

### How Privacy Works

1. **Client-Side Encryption**: Your move is encrypted locally before leaving your browser
2. **On-Chain Storage**: Only encrypted data (euint8) is stored on blockchain
3. **FHE Computation**: Winner is computed without decrypting individual moves
4. **Result Only**: Only the final winner is revealed - moves stay encrypted

**Key Technologies:**
- FHEVM for encrypted computation
- euint8 encrypted integers for moves
- TFHE library for FHE operations
- Client-side encryption with fhevm-sdk

<details>
<summary>🔍 Click to see detailed code examples</summary>

### Client-side Encryption
```typescript
// 1. Get FHEVM instance
const instance = await createInstance({ provider, chainId: 11155111 });

// 2. Encrypt move (0=Rock, 1=Paper, 2=Scissors)
const encryptedMove = await instance.encrypt8(move);

// 3. Send to contract
await contract.createAndCommit(
  encryptedMove.handles[0],
  encryptedMove.inputProof,
  mode,
  stake,
  deadline
);
```

### Contract-side Storage
```solidity
// Store encrypted moves
matches[matchId].encMoveA = TFHE.asEuint8(encMove);
matches[matchId].encMoveB = TFHE.asEuint8(encMove);

// Compute winner in FHE
euint8 result = computeWinner(encMoveA, encMoveB);
```

### FHE Winner Logic
```solidity
function computeWinner(euint8 moveA, euint8 moveB) 
    internal view returns (euint8) 
{
    // All comparisons happen in encrypted space
    // Rock(0) beats Scissors(2), Paper(1) beats Rock(0), etc.
    ebool aWins = TFHE.or(
        TFHE.and(TFHE.eq(moveA, 0), TFHE.eq(moveB, 2)),
        TFHE.or(
            TFHE.and(TFHE.eq(moveA, 1), TFHE.eq(moveB, 0)),
            TFHE.and(TFHE.eq(moveA, 2), TFHE.eq(moveB, 1))
        )
    );
    // ...
}
```

</details>

## 🧪 Testing

### Run Contract Tests
```bash
cd contracts
npm test
```

### Test Coverage
- Match creation
- Match joining
- Winner resolution
- Timeout handling
- Claim mechanisms

## 📁 Project Structure

```
zama/
├── contracts/                 # Hardhat project
│   ├── contracts/
│   │   └── PrivateRPS.sol    # Main game contract
│   ├── test/
│   │   └── PrivateRPS.ts     # Contract tests
│   ├── scripts/
│   │   └── syncContracts.ts  # Sync to frontend
│   ├── deploy/
│   │   └── deploy_rps.ts     # Deployment script
│   └── deployments/sepolia/  # Deployed artifacts
│
├── apps/web/                  # Frontend monorepo
│   └── packages/
│       ├── nextjs/
│       │   ├── app/rps/      # Game UI
│       │   ├── hooks/        # Contract hooks
│       │   └── components/   # Reusable components
│       └── fhevm-sdk/        # FHE utilities
│
└── README.md                  # This file
```

## 🎥 Demo Video

[Optional: Add link to demo video showcasing gameplay]

## 🔐 Privacy Guarantees

### What Stays Encrypted Forever? 🔒
- ✅ **Your move in every game** (encrypted as euint8)
- ✅ **Your entire play history** - all past moves remain encrypted on-chain
- ✅ **Opponent's moves** - you never see what they played
- ✅ **Game logic computation** (FHE operations)
- ✅ **Intermediate results** during resolution

**This means:**
- 🛡️ No one can analyze your play patterns
- 🛡️ No one can predict your next move based on history
- 🛡️ No one can scrape blockchain data to study your strategy
- 🛡️ Even Etherscan shows only encrypted data

### What's Public? 📢
- ✅ Match creation events (someone started a game)
- ✅ Player addresses (who's playing)
- ✅ Final winner (after resolution)
- ✅ Stakes and prizes

**Privacy First**: We reveal only what's necessary for the game to function. Your actual moves? Forever encrypted! 🔐

## 🐛 Known Limitations

1. **RPC Rate Limits**: Free-tier Sepolia RPC can be slow
   - Solution: Implemented retry logic (30 attempts × 2s)
   
2. **Gas Costs**: FHE operations are more expensive than standard
   - Typical match: ~500k-800k gas
   
3. **Matchmaking**: Simple queue system
   - Future: Could add ELO ratings, multiple stake tiers

## 🚦 Future Enhancements

- [ ] Multiple stake tiers
- [ ] Tournament mode
- [ ] Player statistics and leaderboards  
- [ ] Best-of-3 matches
- [ ] Encrypted chat between players
- [ ] Mobile-responsive design improvements

## 📝 License

MIT License - see contracts/LICENSE and apps/web/LICENSE

## 🙏 Acknowledgments

- **Zama**: For FHEVM protocol and amazing FHE technology
- **fhEVM Solidity**: Smart contract library
- **Scaffold-ETH 2**: Frontend boilerplate inspiration

## 📧 Contact

For questions or issues, please open a GitHub issue.

---

**Built with ❤️ for Zama Bounty Program - Builder Track**

*Demonstrating practical FHE use cases in gaming with complete privacy preservation*
