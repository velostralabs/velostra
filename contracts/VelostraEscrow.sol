// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title VelostraEscrow
/// @notice Settlement + escrow contract for the Velostra AI agent marketplace,
///         deployed on Robinhood Chain (Arbitrum Orbit L2, chainId 4663).
/// @dev EVM port of the original Solana/Anchor `velostra` program. Same
///      economics (90/10 builder/platform split), same account shapes,
///      re-expressed as Solidity storage + ERC20 stablecoin transfers
///      instead of SPL token CPIs.
contract VelostraEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────
    // Config
    // ─────────────────────────────────────

    /// @notice Settlement stablecoin (e.g. USDG/USDC bridged to Robinhood Chain)
    IERC20 public immutable settlementToken;

    /// @notice Platform fee in basis points (1000 = 10%)
    uint16 public platformFeeBps;

    /// @notice Minimum top-up / call price, in token's smallest unit
    uint256 public constant MIN_TOPUP = 1e6; // $1.00 assuming 6-decimal stablecoin

    uint256 public totalVolume;
    uint256 public totalPlatformRevenue;
    uint256 public platformRevenueAvailable;

    struct BuilderAccount {
        uint256 totalEarned;
        uint256 availableToClaim;
        uint256 totalClaimed;
        bool initialized;
    }

    struct DepositRecord {
        uint256 amount;
        uint256 timestamp;
    }

    mapping(address => BuilderAccount) public builders;
    mapping(address => DepositRecord) public lastDeposit;
    mapping(address => uint256) public userCreditBalance;
    mapping(bytes32 => bool) public settledCallIds;

    // ─────────────────────────────────────
    // Events
    // ─────────────────────────────────────

    event Deposit(address indexed user, uint256 amount, uint256 timestamp);
    event BuilderInitialized(address indexed builder);
    event EarningsCredited(
        address indexed builder,
        bytes32 indexed callId,
        uint256 amount,
        uint256 platformCut
    );
    event Claimed(address indexed builder, uint256 amount, uint256 timestamp);
    event PlatformRevenueWithdrawn(address indexed to, uint256 amount);
    event PlatformFeeUpdated(uint16 newFeeBps);

    // ─────────────────────────────────────
    // Errors
    // ─────────────────────────────────────

    error AmountTooLow();
    error InvalidAmount();
    error InsufficientEarnings();
    error InsufficientPlatformRevenue();
    error BuilderNotInitialized();
    error InvalidCallId();
    error CallAlreadySettled();
    error FeeTooHigh();

    constructor(address _settlementToken, uint16 _platformFeeBps, address _owner) Ownable(_owner) {
        if (_platformFeeBps > 5000) revert FeeTooHigh(); // hard cap at 50%
        settlementToken = IERC20(_settlementToken);
        platformFeeBps = _platformFeeBps;
    }

    // ─────────────────────────────────────
    // User: deposit credits (top up)
    // ─────────────────────────────────────

    /// @notice User deposits stablecoin into platform escrow to top up call credits.
    function depositCredits(uint256 amount) external nonReentrant {
        if (amount < MIN_TOPUP) revert AmountTooLow();

        settlementToken.safeTransferFrom(msg.sender, address(this), amount);

        userCreditBalance[msg.sender] += amount;
        lastDeposit[msg.sender] = DepositRecord({ amount: amount, timestamp: block.timestamp });

        emit Deposit(msg.sender, amount, block.timestamp);
    }

    // ─────────────────────────────────────
    // Builder lifecycle
    // ─────────────────────────────────────

    function initializeBuilder() external {
        BuilderAccount storage b = builders[msg.sender];
        require(!b.initialized, "already initialized");
        b.initialized = true;
        emit BuilderInitialized(msg.sender);
    }

    /// @notice Called by the platform authority after a metered agent call settles.
    /// @param builder Address of the agent builder being credited.
    /// @param grossAmount Full call price paid by the user, before split.
    /// @param callId keccak256 hash of the durable backend agent_calls.id.
    function creditBuilderEarnings(
        address builder,
        uint256 grossAmount,
        bytes32 callId
    ) external onlyOwner {
        BuilderAccount storage b = builders[builder];
        if (!b.initialized) revert BuilderNotInitialized();
        if (grossAmount == 0) revert InvalidAmount();
        if (callId == bytes32(0)) revert InvalidCallId();
        if (settledCallIds[callId]) revert CallAlreadySettled();

        settledCallIds[callId] = true;

        uint256 platformCut = (grossAmount * platformFeeBps) / 10_000;
        uint256 builderCut = grossAmount - platformCut;

        b.totalEarned += builderCut;
        b.availableToClaim += builderCut;

        totalVolume += grossAmount;
        totalPlatformRevenue += platformCut;
        platformRevenueAvailable += platformCut;

        emit EarningsCredited(builder, callId, builderCut, platformCut);
    }

    /// @notice Builder claims available earnings to their own wallet.
    function claimEarnings(uint256 amount) external nonReentrant {
        BuilderAccount storage b = builders[msg.sender];
        if (amount == 0) revert InvalidAmount();
        if (amount > b.availableToClaim) revert InsufficientEarnings();

        b.availableToClaim -= amount;
        b.totalClaimed += amount;

        settlementToken.safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, amount, block.timestamp);
    }

    // ─────────────────────────────────────
    // Platform admin
    // ─────────────────────────────────────

    function withdrawPlatformRevenue(address to, uint256 amount) external onlyOwner nonReentrant {
        if (amount > platformRevenueAvailable) revert InsufficientPlatformRevenue();
        platformRevenueAvailable -= amount;
        settlementToken.safeTransfer(to, amount);
        emit PlatformRevenueWithdrawn(to, amount);
    }

    function setPlatformFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > 5000) revert FeeTooHigh();
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(newFeeBps);
    }

    // ─────────────────────────────────────
    // Views
    // ─────────────────────────────────────

    function getBuilderAccount(address builder) external view returns (BuilderAccount memory) {
        return builders[builder];
    }
}
