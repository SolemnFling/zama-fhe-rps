// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint8, externalEuint8, eaddress} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title PrivateRPS - 基于 FHEVM 的隐私石头剪刀布
/// @notice 采用加密整数 euint8 表示出手：0=R,1=P,2=S；合约内进行密态判胜，仅公开赢家与清算信息。
contract PrivateRPS is SepoliaConfig {
    // ============ 基础类型与常量 ============
    enum MatchMode { PRACTICE, WAGER }
    enum State { CREATED, JOINED, LOCKED, RESOLVED, EXPIRED }

    struct MatchInfo {
        address playerA;
        address playerB;
        uint256 stake; // 单方押注额（WAGER 模式使用）
        uint64 deadline; // 截止时间（unix seconds）
        MatchMode mode;
        State state;
        // 双方密态出手（euint8：0,1,2）。提交后持久化，避免泄露中间值。
        euint8 moveA;
        euint8 moveB;
        // 赢家（明文），仅在 RESOLVED 后写入；平局或超时为 address(0)
        address winner;
        // 赢家（密文），仅双方可解；通过 getEncryptedOutcome 暴露句柄
        eaddress winnerEnc;
    }

    // ============ 管理员参数 ============
    address public owner;
    uint16 public rakeBps; // 仅在“非超时且产生胜者”的对局抽水（基点，0-10000）
    address public feeRecipient;
    uint256 public minStake;
    uint256 public maxStake;
    uint64 public maxDeadlineDelta; // 从当前时间起的最大允许截止秒数
    address public relayer; // 可信解密回传者（可选），未设置则仅依赖 KMS 回调
    uint64 public attestGrace; // 判定后等待玩家共识回写的宽限期（秒）

    // ============ 存储 ============
    mapping(bytes32 => MatchInfo) public matches;
    // 解密回调映射：requestID -> matchId
    mapping(uint256 => bytes32) public requestIdToMatchId;
    // 玩家共识回写（可选）：记录双方各自的赢家认定
    mapping(bytes32 => mapping(address => address)) public attestedWinner;
    // 匹配队列：(mode, stake) → 等待中的 matchId 列表
    mapping(bytes32 => bytes32[]) public matchQueue;

    // 简易重入保护
    uint256 private _entered;

    // ============ 事件 ============
    event MatchCreated(bytes32 indexed matchId, address indexed playerA, MatchMode mode, uint256 stake, uint64 deadline);
    event MatchJoined(bytes32 indexed matchId, address indexed playerB);
    event MoveSubmitted(bytes32 indexed matchId, address indexed player);
    event MatchResolved(bytes32 indexed matchId, State state, address winner);
    event Claimed(bytes32 indexed matchId, address indexed account, uint256 amount);
    event FeePaid(bytes32 indexed matchId, address indexed recipient, uint256 fee);
    event DecryptionRequested(uint256 indexed requestID, bytes32 indexed matchId);
    event WinnerAttested(bytes32 indexed matchId, address indexed player, address winner);

    // ============ 修饰器 ============
    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(_entered == 0, "reentrancy");
        _entered = 1;
        _;
        _entered = 0;
    }

    // ============ 构造 ============
    constructor() {
        owner = msg.sender;
        feeRecipient = msg.sender;
        // 默认参数（可修改）
        rakeBps = 0;
        minStake = 0;
        maxStake = type(uint256).max;
        maxDeadlineDelta = 2 days;
        attestGrace = 10 minutes;
    }

    // ============ 管理接口 ============
    function setFeeParams(uint16 _rakeBps, address _feeRecipient) external onlyOwner {
        require(_rakeBps <= 10000, "bps range");
        require(_feeRecipient != address(0), "bad recipient");
        rakeBps = _rakeBps;
        feeRecipient = _feeRecipient;
    }

    function setStakeRange(uint256 _minStake, uint256 _maxStake) external onlyOwner {
        require(_maxStake == 0 || _maxStake >= _minStake, "range");
        minStake = _minStake;
        maxStake = _maxStake == 0 ? type(uint256).max : _maxStake;
    }

    function setMaxDeadlineDelta(uint64 _maxDelta) external onlyOwner {
        require(_maxDelta > 0, "bad delta");
        maxDeadlineDelta = _maxDelta;
    }

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
    }

    function setAttestGrace(uint64 _sec) external onlyOwner {
        require(_sec > 0 && _sec <= 7 days, "bad grace");
        attestGrace = _sec;
    }

    // ============ 只读 ============
    function getStatus(bytes32 matchId)
        external
        view
        returns (State state, address playerA, address playerB, uint256 stake, uint64 deadline, MatchMode mode, address winner)
    {
        MatchInfo storage m = matches[matchId];
        return (m.state, m.playerA, m.playerB, m.stake, m.deadline, m.mode, m.winner);
    }

    /// @notice 仅在双方提交后可读取密态赢家句柄；仅双方地址可解密
    function getEncryptedOutcome(bytes32 matchId) external view returns (bytes32 winnerHandle) {
        MatchInfo storage m = matches[matchId];
        require(m.playerA != address(0) && m.playerB != address(0), "not found");
        require(m.state == State.LOCKED || m.state == State.RESOLVED, "unavailable");
        return FHE.toBytes32(m.winnerEnc);
    }

    // ============ 统一出手入口 ============
    /// @notice 创建对局并提交加密出手 (合约自动生成 matchId)
    /// @param encMove 外部加密的 euint8（0=R,1=P,2=S）
    /// @param inputProof 密文输入证明
    /// @param mode 对局模式 (PRACTICE=0, WAGER=1)
    /// @param stake 单方押注额 (PRACTICE 必须为 0)
    /// @param deadline 截止时间 (unix seconds)
    /// @return matchId 对局 ID (合约生成)
    function createAndCommit(
        externalEuint8 encMove,
        bytes calldata inputProof,
        MatchMode mode,
        uint256 stake,
        uint64 deadline
    ) external payable returns (bytes32 matchId) {
        require(deadline > block.timestamp, "deadline past");
        require(deadline - uint64(block.timestamp) <= maxDeadlineDelta, "deadline too far");

        if (mode == MatchMode.PRACTICE) {
            require(stake == 0, "practice stake=0");
            require(msg.value == 0, "no ETH for practice");
        } else {
            // WAGER
            require(stake >= minStake && stake <= maxStake, "stake range");
            require(msg.value == stake, "stake mismatch");
        }

        // 合约生成 matchId (不依赖用户输入)
        matchId = keccak256(abi.encodePacked(msg.sender, block.timestamp, block.prevrandao));

        MatchInfo storage m = matches[matchId];
        m.playerA = msg.sender;
        m.mode = mode;
        m.state = State.CREATED;
        m.stake = stake;
        m.deadline = deadline;
        m.moveA = FHE.fromExternal(encMove, inputProof);
        FHE.allowThis(m.moveA);

        // 加入匹配队列
        bytes32 queueKey = keccak256(abi.encodePacked(mode, stake));
        matchQueue[queueKey].push(matchId);

        emit MatchCreated(matchId, msg.sender, mode, stake, deadline);
        emit MoveSubmitted(matchId, msg.sender);
        return matchId;
    }

    /// @notice 加入指定对局并提交加密出手
    /// @param matchId 要加入的对局 ID
    /// @param encMove 外部加密的 euint8（0=R,1=P,2=S）
    /// @param inputProof 密文输入证明
    function joinAndCommit(
        bytes32 matchId,
        externalEuint8 encMove,
        bytes calldata inputProof
    ) external payable {
        MatchInfo storage m = matches[matchId];
        require(m.playerA != address(0), "not found");
        require(m.playerB == address(0), "full");
        require(m.state == State.CREATED, "bad state");
        require(block.timestamp < m.deadline, "expired");
        require(msg.sender != m.playerA, "same player");

        if (m.mode == MatchMode.WAGER) {
            require(msg.value == m.stake, "stake mismatch");
        } else {
            require(msg.value == 0, "no ETH for practice");
        }

        m.playerB = msg.sender;
        m.moveB = FHE.fromExternal(encMove, inputProof);
        FHE.allowThis(m.moveB);
        m.state = State.LOCKED;

        // 从队列中移除
        bytes32 queueKey = keccak256(abi.encodePacked(m.mode, m.stake));
        _removeFromQueue(queueKey, matchId);

        emit MatchJoined(matchId, msg.sender);
        emit MoveSubmitted(matchId, msg.sender);
    }

    /// @notice 内部函数：从队列中移除指定 matchId
    function _removeFromQueue(bytes32 queueKey, bytes32 matchId) internal {
        bytes32[] storage queue = matchQueue[queueKey];
        for (uint256 i = 0; i < queue.length; i++) {
            if (queue[i] == matchId) {
                queue[i] = queue[queue.length - 1];
                queue.pop();
                return;
            }
        }
    }

    /// @notice 查看指定 (mode, stake) 的等待对局列表
    /// @param mode 对局模式
    /// @param stake 押注金额
    /// @param offset 起始索引
    /// @param limit 返回数量上限
    /// @return matchIds 等待中的对局 ID 列表
    /// @return total 队列总长度
    function getPendingMatches(
        MatchMode mode,
        uint256 stake,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory matchIds, uint256 total) {
        bytes32 queueKey = keccak256(abi.encodePacked(mode, stake));
        bytes32[] storage queue = matchQueue[queueKey];
        total = queue.length;

        if (offset >= total) {
            return (new bytes32[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLen = end - offset;
        matchIds = new bytes32[](resultLen);
        for (uint256 i = 0; i < resultLen; i++) {
            matchIds[i] = queue[offset + i];
        }

        return (matchIds, total);
    }

    /// @notice 查看指定 (mode, stake) 的等待对局数量
    function getPendingMatchCount(MatchMode mode, uint256 stake) external view returns (uint256) {
        bytes32 queueKey = keccak256(abi.encodePacked(mode, stake));
        return matchQueue[queueKey].length;
    }

    // ============ 判定与解密回调 ============
    /// 任何人可调用以推进状态；
    /// - 若到期未双向提交：标记 EXPIRED（退款路径）
    /// - 若双方提交：生成赢家密文地址并请求解密；平局则 winner=address(0)
    function resolve(bytes32 matchId) external nonReentrant {
        MatchInfo storage m = matches[matchId];
        require(m.playerA != address(0) && m.playerB != address(0), "not found");
        require(m.state == State.JOINED || m.state == State.LOCKED, "bad state");

        if (!(FHE.isInitialized(m.moveA) && FHE.isInitialized(m.moveB))) {
            // 未双向提交
            require(block.timestamp >= m.deadline, "not expired");
            m.state = State.EXPIRED;
            emit MatchResolved(matchId, m.state, address(0));
            return;
        }

        // 双方已提交，进行密态判胜
        // A==R && B==S  ||  A==S && B==P  ||  A==P && B==R
        ebool AeqR = FHE.eq(m.moveA, FHE.asEuint8(0));
        ebool AeqP = FHE.eq(m.moveA, FHE.asEuint8(1));
        ebool AeqS = FHE.eq(m.moveA, FHE.asEuint8(2));
        ebool BeqR = FHE.eq(m.moveB, FHE.asEuint8(0));
        ebool BeqP = FHE.eq(m.moveB, FHE.asEuint8(1));
        ebool BeqS = FHE.eq(m.moveB, FHE.asEuint8(2));

        ebool aWin = FHE.or(FHE.or(FHE.and(AeqR, BeqS), FHE.and(AeqS, BeqP)), FHE.and(AeqP, BeqR));
        ebool isDraw = FHE.eq(m.moveA, m.moveB);
        ebool bWin = FHE.and(FHE.not(aWin), FHE.not(isDraw));

        // winner 加密地址选择
        eaddress aAddr = FHE.asEaddress(m.playerA);
        eaddress bAddr = FHE.asEaddress(m.playerB);
        eaddress none = FHE.asEaddress(address(0));
        eaddress winnerEnc = FHE.select(aWin, aAddr, FHE.select(bWin, bAddr, none));

        // 允许本合约与双方读取该密文（便于回传/事件/claim 判定）
        FHE.allowThis(winnerEnc);
        FHE.allow(winnerEnc, m.playerA);
        FHE.allow(winnerEnc, m.playerB);

        // 存储密态赢家并请求解密；保持 LOCKED，待回调 onDecryption 写入明文赢家并置 RESOLVED
        m.winnerEnc = winnerEnc;
        m.winner = address(0); // 明文赢家待回调写入（可能为 address(0) 表示平局）

        // 请求解密（KMS 路径：本仓库未直接集成 request API；采用事件 + 可信 relayer 触发回写）
        // KMS 场景可由外部监听本事件并调用 onDecryption；
        // 备用场景由 relayer 解密后调用 finalizeWinner
        m.state = State.LOCKED;
        emit DecryptionRequested(0, matchId);
    }

    /// 解密回调（由 relayer 调用）
    /// cleartexts 为 1 个 32 字节值，低 20 字节为地址
    function onDecryption(uint256 requestID, bytes calldata cleartexts, bytes calldata decryptionProof) external nonReentrant {
        // 验证签名与回包
        FHE.checkSignatures(requestID, cleartexts, decryptionProof);
        bytes32 matchId = requestIdToMatchId[requestID];
        MatchInfo storage m = matches[matchId];
        require(m.state == State.LOCKED, "bad state");

        // 解析地址
        require(cleartexts.length >= 32, "bad cleartext");
        address winnerAddr = address(uint160(uint256(bytes32(cleartexts[0:32]))));
        m.winner = winnerAddr; // 可能为 address(0)（平局）
        m.state = State.RESOLVED;
        emit MatchResolved(matchId, m.state, m.winner);
        // 清理 requestId 映射，避免重复使用
        delete requestIdToMatchId[requestID];
    }

    /// 可信 relayer 直接写入赢家（备用通道，无需 KMS 签名）
    function finalizeWinner(bytes32 matchId, address winnerAddr) external nonReentrant {
        require(msg.sender == relayer || msg.sender == owner, "not relayer");
        MatchInfo storage m = matches[matchId];
        require(m.playerA != address(0) && m.playerB != address(0), "not found");
        require(m.state == State.LOCKED, "bad state");
        m.winner = winnerAddr; // 可为 address(0) 表示平局
        m.state = State.RESOLVED;
        emit MatchResolved(matchId, m.state, m.winner);
    }

    /// 玩家共识回写：A/B 分别提交各自解密的赢家；一致则写入明文赢家
    function attestWinner(bytes32 matchId, address winnerAddr) external nonReentrant {
        MatchInfo storage m = matches[matchId];
        require(m.playerA != address(0) && m.playerB != address(0), "not found");
        require(m.state == State.LOCKED, "bad state");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "not player");
        attestedWinner[matchId][msg.sender] = winnerAddr; // winnerAddr 可为 0 表示平局
        emit WinnerAttested(matchId, msg.sender, winnerAddr);

        address aw = attestedWinner[matchId][m.playerA];
        address bw = attestedWinner[matchId][m.playerB];
        if (aw == address(0) && bw == address(0)) {
            // 双方一致认为平局
            m.winner = address(0);
            m.state = State.RESOLVED;
            emit MatchResolved(matchId, m.state, m.winner);
        } else if (aw != address(0) && aw == bw) {
            // 双方一致同意赢家
            m.winner = aw;
            m.state = State.RESOLVED;
            emit MatchResolved(matchId, m.state, m.winner);
        }
    }

    /// 超时兜底：LOCKED 且超过 grace 后，任何人可将其标记为平局（各退）
    function expireLocked(bytes32 matchId) external nonReentrant {
        MatchInfo storage m = matches[matchId];
        require(m.state == State.LOCKED, "bad state");
        require(block.timestamp >= m.deadline + attestGrace, "not due");
        m.winner = address(0);
        m.state = State.RESOLVED;
        emit MatchResolved(matchId, m.state, m.winner);
    }

    /// @notice 标记过期的 CREATED 对局（只有 playerA，无 playerB）
    /// @dev 任何人可调用，将过期未匹配的对局标记为 EXPIRED，以便 playerA 取回押金
    function expireCreated(bytes32 matchId) external nonReentrant {
        MatchInfo storage m = matches[matchId];
        require(m.playerA != address(0), "not found");
        require(m.state == State.CREATED, "bad state");
        require(m.playerB == address(0), "already joined");
        require(block.timestamp >= m.deadline, "not expired");

        m.state = State.EXPIRED;

        // 从队列中移除
        bytes32 queueKey = keccak256(abi.encodePacked(m.mode, m.stake));
        _removeFromQueue(queueKey, matchId);

        emit MatchResolved(matchId, m.state, address(0));
    }

    // ============ 结算 ============
    function claim(bytes32 matchId) external nonReentrant {
        MatchInfo storage m = matches[matchId];
        require(m.playerA != address(0), "not found");
        require(m.mode == MatchMode.WAGER, "practice no funds");

        if (m.state == State.EXPIRED) {
            // 超时未成局：退款
            // 如果只有 playerA (playerB 未加入)，只退给 playerA
            // 如果双方都加入了，双方都退
            if (m.playerB == address(0)) {
                // 只有 playerA
                require(msg.sender == m.playerA, "not playerA");
                _payout(matchId, m.playerA, m.stake);
            } else {
                // 双方都加入了但超时
                _payout(matchId, m.playerA, m.stake);
                _payout(matchId, m.playerB, m.stake);
            }
            // 置为 RESOLVED，避免重复提取
            m.state = State.RESOLVED;
            return;
        }

        require(m.playerA != address(0) && m.playerB != address(0), "incomplete match");
        require(m.state == State.RESOLVED, "not resolved");

        if (m.winner == address(0)) {
            // 平局：各退押注
            _payout(matchId, m.playerA, m.stake);
            _payout(matchId, m.playerB, m.stake);
            return;
        }

        // 有胜者：胜者领取 2*stake - fee；失败者无需再调用
        require(msg.sender == m.winner, "not winner");
        uint256 total = m.stake * 2;
        uint256 fee = (rakeBps == 0) ? 0 : (total * rakeBps) / 10000;
        uint256 amount = total - fee;

        if (fee > 0) {
            (bool okF, ) = feeRecipient.call{value: fee}("");
            require(okF, "fee xfer");
            emit FeePaid(matchId, feeRecipient, fee);
        }

        _payout(matchId, m.winner, amount);
    }

    // ============ 内部 ============
    function _payout(bytes32 matchId, address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "xfer");
        emit Claimed(matchId, to, amount);
    }

    // 接收 ETH（押注）
    receive() external payable {}
}
