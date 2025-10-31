# Private RPS Smart Contracts

Solidity smart contracts for the Private Rock-Paper-Scissors game using FHEVM.

## Main Contract

**`PrivateRPS.sol`** - Core game logic with FHE operations

### Key Features
- Encrypted move storage (euint8: 0=Rock, 1=Paper, 2=Scissors)
- Automatic matchmaking queue
- FHE-based winner computation
- Two game modes: PRACTICE (free) and WAGER (0.001 ETH)
- Timeout protection (15 minutes)
- Prize claiming system with rake mechanism

## Quick Start

### Installation
```bash
npm ci
```

### Compile
```bash
npm run compile
```

### Run Tests
```bash
npm test
```

### Deploy to Sepolia
```bash
# Set private key
npx hardhat vars set PRIVATE_KEY

# Deploy
npm run deploy:sepolia

# Sync to frontend
npx tsx scripts/syncContracts.ts
```

## Contract Architecture

### Game Flow
1. **Create Match**: Player A encrypts move and creates match
2. **Join Match**: Player B encrypts move and joins
3. **Resolve**: Either player computes winner using FHE
4. **Claim**: Winner claims prize

### Winner Computation (FHE)
```solidity
// A wins if:
// (A==Rock && B==Scissors) || (A==Scissors && B==Paper) || (A==Paper && B==Rock)

euint8 result = computeWinner(encMoveA, encMoveB);
// result: 0=draw, 1=A wins, 2=B wins
```

### Economic Model
- **PRACTICE**: stake=0, no fees
- **WAGER**: Winner pays rake (default 5%), loser pays nothing
- **Timeout/Draw**: Full refund to both players

## Key Functions

```solidity
// Create new match
function createAndCommit(
    einput encMove,
    bytes calldata inputProof,
    MatchMode mode,
    uint256 stakeWei,
    uint64 deadline
) external payable returns (bytes32 matchId)

// Join existing match
function joinAndCommit(
    bytes32 matchId,
    einput encMove,
    bytes calldata inputProof
) external payable

// Resolve match (compute winner)
function resolve(bytes32 matchId) external

// Claim prize
function claim(bytes32 matchId) external

// Mark expired match
function expireCreated(bytes32 matchId) external

// Query functions
function getStatus(bytes32 matchId) external view returns (...)
function getPendingMatches(...) external view returns (...)
```

## Testing

Tests cover:
- ✅ Match creation and joining
- ✅ Winner resolution (Rock beats Scissors, etc.)
- ✅ Draw scenarios
- ✅ Timeout handling
- ✅ Prize claiming
- ✅ Access control

Run tests:
```bash
npm test
```

## Gas Estimates

| Operation | Gas Cost |
|-----------|----------|
| Create match | ~400k-500k |
| Join match | ~400k-500k |
| Resolve | ~200k-300k |
| Claim | ~50k-80k |

*Note: FHE operations are more expensive but provide complete privacy*

## Deployment Info

Current deployment on Sepolia testnet:
- See `deployments/sepolia/PrivateRPS.json`
- Network: Sepolia (Chain ID: 11155111)

## Technical Notes

- Uses `viaIR` compiler setting for complex FHE operations
- Encrypted moves stored as `euint8`
- Winner computed entirely in FHE (no reveal step)
- Supports client-side decryption for outcome verification
