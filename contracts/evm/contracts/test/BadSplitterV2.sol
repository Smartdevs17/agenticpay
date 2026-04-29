// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/// @notice Intentionally storage-incompatible rewrite of SplitterV1. Used
///         by the upgrade-safety tests to prove that bad upgrades are
///         rejected before the proxy is pointed at them.
/// @dev The ONLY upgrade-safety violation is storage layout: `totalSplits`
///      is inserted ahead of `platformFeeBps`, which would corrupt state
///      on a live proxy. Every other aspect (parent inits, UUPS auth,
///      constructor) matches a well-formed implementation so the test
///      asserts against the right error class.
contract BadSplitterV2 is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    // NOTE: `totalSplits` appears BEFORE `platformFeeBps`, which conflicts
    // with SplitterV1's storage layout.
    uint256 public totalSplits;
    uint16 public platformFeeBps;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
