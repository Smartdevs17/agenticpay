// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/// @title AgenticPay Splitter (V1, UUPS-upgradeable)
/// @notice Distributes incoming payments across a configurable set of
///         recipients while retaining a basis-point platform fee.
/// @dev Upgradeable variant of the original `Splitter.sol`. Storage layout
///      is versioned via `__gap` so future releases can add state without
///      breaking the proxy. Upgrades are gated to the owner.
contract SplitterV1 is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    struct Recipient {
        address wallet;
        uint16 bps; // basis points (10000 = 100%)
        uint256 minThreshold;
        bool active;
    }

    uint16 public platformFeeBps;
    Recipient[] public recipients;

    event RecipientConfigured(
        uint256 indexed index,
        address wallet,
        uint16 bps,
        uint256 minThreshold,
        bool active
    );
    event PlatformFeeUpdated(uint16 feeBps);
    event PaymentSplit(uint256 totalAmount, uint256 platformFee, uint256 distributedAmount);

    error InvalidFee(uint16 bps);
    error InvalidRecipient();
    error InvalidIndex(uint256 index);
    error NoPayment();
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed(address to, uint256 amount);

    /// @notice Prevents the implementation contract from being initialised.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Proxy-friendly constructor replacement. Called exactly once
    ///         through the proxy when the contract is first deployed.
    /// @param owner_           Address that receives ownership privileges.
    /// @param initialFeeBps    Initial platform fee, in basis points.
    function initialize(address owner_, uint16 initialFeeBps) external initializer {
        if (initialFeeBps > 10_000) revert InvalidFee(initialFeeBps);
        if (owner_ == address(0)) revert InvalidRecipient();

        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        platformFeeBps = initialFeeBps;
        emit PlatformFeeUpdated(initialFeeBps);
    }

    function setPlatformFeeBps(uint16 feeBps) external onlyOwner {
        if (feeBps > 10_000) revert InvalidFee(feeBps);
        platformFeeBps = feeBps;
        emit PlatformFeeUpdated(feeBps);
    }

    function setRecipient(
        uint256 index,
        address wallet,
        uint16 bps,
        uint256 minThreshold,
        bool active
    ) external onlyOwner {
        if (wallet == address(0)) revert InvalidRecipient();
        if (bps > 10_000) revert InvalidFee(bps);

        Recipient memory next = Recipient(wallet, bps, minThreshold, active);
        if (index < recipients.length) {
            recipients[index] = next;
        } else if (index == recipients.length) {
            recipients.push(next);
        } else {
            revert InvalidIndex(index);
        }

        emit RecipientConfigured(index, wallet, bps, minThreshold, active);
    }

    function recipientsCount() external view returns (uint256) {
        return recipients.length;
    }

    function splitPayment() external payable virtual nonReentrant {
        _splitPayment();
    }

    /// @dev Core distribution logic, factored out so V2+ can layer
    ///      additional checks (pause, allowlist, etc.) in front of the
    ///      same accounting code.
    function _splitPayment() internal {
        if (msg.value == 0) revert NoPayment();

        uint256 platformFee = (msg.value * platformFeeBps) / 10_000;
        uint256 distributable = msg.value - platformFee;
        uint256 distributed;

        uint256 len = recipients.length;
        for (uint256 i = 0; i < len; i++) {
            Recipient memory recipient = recipients[i];
            if (!recipient.active || recipient.bps == 0) continue;

            uint256 amount = (distributable * recipient.bps) / 10_000;
            if (amount < recipient.minThreshold) continue;
            distributed += amount;

            (bool ok, ) = recipient.wallet.call{value: amount}("");
            if (!ok) revert TransferFailed(recipient.wallet, amount);
        }

        // Platform fee and any undistributed dust remain in the contract
        // and are withdrawable by the owner.
        emit PaymentSplit(msg.value, platformFee, distributed);
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        uint256 available = address(this).balance;
        if (amount > available) revert InsufficientBalance(amount, available);

        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed(to, amount);
    }

    /// @notice Human-readable version string, also used by upgrade tests to
    ///         detect which implementation the proxy currently points at.
    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }

    /// @dev UUPS requires the implementation to decide who may upgrade.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @dev Reserved storage slots for future versions to consume without
    ///      shifting the layout of V1-era fields.
    uint256[48] private __gap;

    receive() external payable {}
}
