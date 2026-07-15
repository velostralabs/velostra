// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VelostraEscrow
/// @notice Correlated settlement and escrow for the Velostra execution market.
/// @dev User credit is an immutable cumulative deposit audit counter. Spendable
///      credit is held in the offchain ledger and reconciled against chain events.
contract VelostraEscrow is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;
    uint8 public constant SUPPORTED_TOKEN_DECIMALS = 6;
    uint256 public constant MIN_TOPUP = 1e6;

    IERC20 public immutable settlementToken;
    uint16 public platformFeeBps;

    uint256 public totalDeposited;
    uint256 public totalVolume;
    uint256 public totalPlatformRevenue;
    uint256 public platformRevenueAvailable;
    uint256 public totalBuilderLiability;

    address public successorEscrow;

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
    event PlatformFeeUpdated(uint16 previousFeeBps, uint16 newFeeBps);
    event SuccessorEscrowDeclared(address indexed successor);
    event AvailableLiquidityMigrated(address indexed successor, uint256 amount);

    error AmountTooLow();
    error InvalidAmount();
    error InvalidAddress();
    error InsufficientEarnings();
    error InsufficientPlatformRevenue();
    error InsufficientEscrowLiquidity();
    error BuilderNotInitialized();
    error BuilderAlreadyInitialized();
    error InvalidCallId();
    error CallAlreadySettled();
    error FeeTooHigh();
    error UnsupportedTokenDecimals(uint8 actual);
    error UnsupportedTokenBehavior();
    error SuccessorAlreadyDeclared();
    error SuccessorNotDeclared();
    error NoAvailableLiquidity();
    error ContractDeprecated();

    modifier whenActive() {
        if (successorEscrow != address(0)) revert ContractDeprecated();
        _;
    }

    constructor(
        address settlementToken_,
        uint16 platformFeeBps_,
        address admin_,
        address settler_,
        address treasury_,
        address pauseGuardian_
    ) AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, admin_) {
        if (
            settlementToken_ == address(0) || admin_ == address(0) ||
            settler_ == address(0) || treasury_ == address(0) ||
            pauseGuardian_ == address(0)
        ) revert InvalidAddress();
        if (platformFeeBps_ > 5000) revert FeeTooHigh();

        uint8 decimals = IERC20Metadata(settlementToken_).decimals();
        if (decimals != SUPPORTED_TOKEN_DECIMALS) {
            revert UnsupportedTokenDecimals(decimals);
        }

        settlementToken = IERC20(settlementToken_);
        platformFeeBps = platformFeeBps_;

        _grantRole(SETTLER_ROLE, settler_);
        _grantRole(TREASURY_ROLE, treasury_);
        _grantRole(PAUSER_ROLE, pauseGuardian_);
        _grantRole(FEE_MANAGER_ROLE, admin_);
    }

    /// @notice Deposit audit counter. Spending is authoritative in the database,
    ///         while this cumulative value never decreases or claims to be spendable.
    function depositCredits(uint256 amount) external nonReentrant whenNotPaused whenActive {
        if (amount < MIN_TOPUP) revert AmountTooLow();

        uint256 balanceBefore = settlementToken.balanceOf(address(this));
        settlementToken.safeTransferFrom(msg.sender, address(this), amount);
        if (settlementToken.balanceOf(address(this)) - balanceBefore != amount) {
            revert UnsupportedTokenBehavior();
        }

        totalDeposited += amount;
        userCreditBalance[msg.sender] += amount;
        lastDeposit[msg.sender] = DepositRecord({ amount: amount, timestamp: block.timestamp });

        emit Deposit(msg.sender, amount, block.timestamp);
    }

    function initializeBuilder() external whenNotPaused whenActive {
        BuilderAccount storage builder = builders[msg.sender];
        if (builder.initialized) revert BuilderAlreadyInitialized();
        builder.initialized = true;
        emit BuilderInitialized(msg.sender);
    }

    function creditBuilderEarnings(
        address builderAddress,
        uint256 grossAmount,
        bytes32 callId
    ) external onlyRole(SETTLER_ROLE) nonReentrant whenNotPaused whenActive {
        BuilderAccount storage builder = builders[builderAddress];
        if (!builder.initialized) revert BuilderNotInitialized();
        if (grossAmount == 0) revert InvalidAmount();
        if (callId == bytes32(0)) revert InvalidCallId();
        if (settledCallIds[callId]) revert CallAlreadySettled();
        if (settlementToken.balanceOf(address(this)) < totalLiabilities() + grossAmount) {
            revert InsufficientEscrowLiquidity();
        }

        settledCallIds[callId] = true;

        uint256 platformCut = (grossAmount * platformFeeBps) / 10_000;
        uint256 builderCut = grossAmount - platformCut;

        builder.totalEarned += builderCut;
        builder.availableToClaim += builderCut;
        totalBuilderLiability += builderCut;

        totalVolume += grossAmount;
        totalPlatformRevenue += platformCut;
        platformRevenueAvailable += platformCut;

        emit EarningsCredited(builderAddress, callId, builderCut, platformCut);
    }

    /// @notice Claims remain available while paused so emergency controls cannot
    ///         trap already-earned builder funds.
    function claimEarnings(uint256 amount) external nonReentrant {
        BuilderAccount storage builder = builders[msg.sender];
        if (amount == 0) revert InvalidAmount();
        if (amount > builder.availableToClaim) revert InsufficientEarnings();

        builder.availableToClaim -= amount;
        builder.totalClaimed += amount;
        totalBuilderLiability -= amount;

        settlementToken.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount, block.timestamp);
    }

    function withdrawPlatformRevenue(
        address to,
        uint256 amount
    ) external onlyRole(TREASURY_ROLE) nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount > platformRevenueAvailable) revert InsufficientPlatformRevenue();

        platformRevenueAvailable -= amount;
        settlementToken.safeTransfer(to, amount);
        emit PlatformRevenueWithdrawn(to, amount);
    }

    function setPlatformFeeBps(uint16 newFeeBps) external onlyRole(FEE_MANAGER_ROLE) {
        if (newFeeBps > 5000) revert FeeTooHigh();
        uint16 previousFeeBps = platformFeeBps;
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(previousFeeBps, newFeeBps);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Announces a replacement while the old escrow remains claims-only.
    ///         Existing liabilities stay collateralized and are never swept.
    function declareSuccessorEscrow(
        address successor
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenPaused {
        if (successor == address(0) || successor == address(this)) revert InvalidAddress();
        if (successorEscrow != address(0)) revert SuccessorAlreadyDeclared();
        successorEscrow = successor;
        emit SuccessorEscrowDeclared(successor);
    }

    /// @notice Moves only unencumbered liquidity to the declared successor.
    ///         Builder and platform liabilities always remain fully backed here.
    function migrateAvailableLiquidity() external onlyRole(TREASURY_ROLE) nonReentrant {
        address successor = successorEscrow;
        if (successor == address(0)) revert SuccessorNotDeclared();

        uint256 balance = settlementToken.balanceOf(address(this));
        uint256 liabilities = totalLiabilities();
        uint256 amount = balance > liabilities ? balance - liabilities : 0;
        if (amount == 0) revert NoAvailableLiquidity();

        settlementToken.safeTransfer(successor, amount);
        emit AvailableLiquidityMigrated(successor, amount);
    }

    function totalLiabilities() public view returns (uint256) {
        return totalBuilderLiability + platformRevenueAvailable;
    }

    function availableEscrowLiquidity() external view returns (uint256) {
        uint256 balance = settlementToken.balanceOf(address(this));
        uint256 liabilities = totalLiabilities();
        return balance > liabilities ? balance - liabilities : 0;
    }

    function isSolvent() external view returns (bool) {
        return settlementToken.balanceOf(address(this)) >= totalLiabilities();
    }

    function getBuilderAccount(address builder) external view returns (BuilderAccount memory) {
        return builders[builder];
    }
}
