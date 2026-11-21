// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgenticPay Revenue Pool
/// @notice Distributes incoming ETH across configurable recipients with
///         accumulated claim balances and a minimum distribution threshold.
///         Each recipient claims their share on-demand rather than being
///         paid out on every distribution.
contract RevenuePool {
    // ── State ────────────────────────────────────────────────────────────────

    address public owner;

    struct Recipient {
        address wallet;
        uint256 ratioBps;     // basis points (10_000 = 100%)
        uint256 accumulated;  // unclaimed ETH balance
    }

    Recipient[] public recipients;
    mapping(address => uint256) private _indexOf; // index + 1 (0 = not found)
    uint256 public totalShares; // sum of all ratioBps, cannot exceed 10_000
    uint256 public minDistributionThreshold;

    // ── Events ───────────────────────────────────────────────────────────────

    event RecipientAdded(address indexed recipient, uint256 ratioBps);
    event RecipientRemoved(
        address indexed recipient,
        uint256 ratioBps,
        uint256 accumulatedClaimed
    );
    event RecipientRatioUpdated(
        address indexed recipient,
        uint256 oldRatioBps,
        uint256 newRatioBps
    );
    event Distributed(uint256 totalAmount);
    event Claimed(address indexed recipient, uint256 amount);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error ZeroAddress();
    error InvalidRatio();
    error TotalExceedsMax();
    error BelowThreshold();
    error TransferFailed();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
    }

    // ── Recipient Management ─────────────────────────────────────────────────

    /// @notice Add a new recipient with a given ratio.
    function addRecipient(address recipient, uint256 ratioBps) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        if (ratioBps == 0 || ratioBps > 10_000) revert InvalidRatio();
        if (_indexOf[recipient] != 0) revert InvalidRatio();

        uint256 newTotal;
        unchecked {
            newTotal = totalShares + ratioBps;
        }
        if (newTotal > 10_000) revert TotalExceedsMax();

        recipients.push(Recipient(recipient, ratioBps, 0));
        _indexOf[recipient] = recipients.length;

        totalShares = newTotal;

        emit RecipientAdded(recipient, ratioBps);
    }

    /// @notice Remove a recipient and forward their accumulated balance.
    function removeRecipient(address recipient) external onlyOwner {
        uint256 idx = _indexOf[recipient];
        if (idx == 0) revert InvalidRatio();

        unchecked {
            uint256 index = idx - 1;
            uint256 lastIndex = recipients.length - 1;

            Recipient storage r = recipients[index];
            uint256 accrued = r.accumulated;
            uint256 ratio = r.ratioBps;
            uint256 remaining;

            // Swap with last and pop
            if (index != lastIndex) {
                Recipient storage last = recipients[lastIndex];
                recipients[index] = last;
                _indexOf[last.wallet] = idx;
            }
            recipients.pop();
            delete _indexOf[recipient];

            unchecked {
                remaining = totalShares - ratio;
            }
            totalShares = remaining;

            // Claim accumulated balance before removing
            if (accrued > 0) {
                r.accumulated = 0;
                (bool ok, ) = recipient.call{value: accrued}("");
                if (!ok) revert TransferFailed();
                emit Claimed(recipient, accrued);
            }

            emit RecipientRemoved(recipient, ratio, accrued);
        }
    }

    /// @notice Update the ratio for an existing recipient.
    function updateRatio(address recipient, uint256 newRatioBps) external onlyOwner {
        if (newRatioBps == 0 || newRatioBps > 10_000) revert InvalidRatio();

        uint256 idx = _indexOf[recipient];
        if (idx == 0) revert InvalidRatio();

        Recipient storage r = recipients[idx - 1];
        uint256 oldRatio = r.ratioBps;

        uint256 newTotal;
        if (newRatioBps > oldRatio) {
            unchecked {
                newTotal = totalShares + newRatioBps - oldRatio;
            }
        } else {
            unchecked {
                newTotal = totalShares - (oldRatio - newRatioBps);
            }
        }
        if (newTotal > 10_000) revert TotalExceedsMax();

        r.ratioBps = newRatioBps;
        totalShares = newTotal;

        emit RecipientRatioUpdated(recipient, oldRatio, newRatioBps);
    }

    // ── Distribution ─────────────────────────────────────────────────────────

    /// @notice Distribute `msg.value` among all recipients by ratio.
    ///         Accumulates shares in each recipient's balance for later claim.
    function distribute() external payable {
        _distribute();
    }

    function _distribute() internal {
        uint256 amount = msg.value;
        if (amount == 0) revert BelowThreshold();

        uint256 len = recipients.length;
        if (len == 0) revert InvalidRatio();

        for (uint256 i; i < len; ) {
            Recipient storage r = recipients[i];
            uint256 share;
            unchecked {
                share = (amount * r.ratioBps) / 10_000;
            }
            if (share > 0) {
                unchecked {
                    r.accumulated += share;
                }
            }
            unchecked {
                ++i;
            }
        }

        emit Distributed(amount);
    }

    // ── Claims ───────────────────────────────────────────────────────────────

    /// @notice Claim the caller's accumulated balance.
    function claim() external {
        address recipient = msg.sender;
        uint256 idx = _indexOf[recipient];
        if (idx == 0) revert InvalidRatio();

        Recipient storage r = recipients[idx - 1];
        uint256 amount = r.accumulated;
        if (amount < minDistributionThreshold) revert BelowThreshold();

        r.accumulated = 0;

        (bool ok, ) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Claimed(recipient, amount);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    /// @notice Return the full list of configured recipients.
    function getRecipients() external view returns (Recipient[] memory) {
        return recipients;
    }

    /// @notice Return the accumulated balance for a given recipient.
    function getAccumulated(address recipient) external view returns (uint256) {
        uint256 idx = _indexOf[recipient];
        if (idx == 0) return 0;
        return recipients[idx - 1].accumulated;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// @notice Set the minimum threshold for claiming.
    function setMinDistributionThreshold(uint256 threshold) external onlyOwner {
        uint256 old = minDistributionThreshold;
        minDistributionThreshold = threshold;
        emit ThresholdUpdated(old, threshold);
    }

    /// @notice Transfer contract ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    /// @notice Auto-distribute any ETH sent directly to the contract.
    receive() external payable {
        _distribute();
    }
}
