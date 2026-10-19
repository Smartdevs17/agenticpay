// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title TokenizedFiat
/// @notice Synthetic fiat token with minter allowlist and emergency controls.
contract TokenizedFiat is ERC20, Ownable, Pausable {
    mapping(address => bool) public minters;
    uint256 public collateralLocked;
    uint256 public minCollateralBps = 10_500; // 105%

    event MinterUpdated(address indexed minter, bool enabled);
    event CollateralUpdated(uint256 collateralLocked, uint256 totalSupply);
    event MinCollateralBpsUpdated(uint256 minCollateralBps);
    event Redeemed(address indexed account, uint256 amount);

    error NotMinter();
    error CollateralRatioTooLow();

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 initialCollateral
    ) ERC20(name_, symbol_) Ownable(owner_) {
        collateralLocked = initialCollateral;
    }

    modifier onlyMinter() {
        if (!minters[msg.sender]) revert NotMinter();
        _;
    }

    function setMinter(address minter, bool enabled) external onlyOwner {
        minters[minter] = enabled;
        emit MinterUpdated(minter, enabled);
    }

    function setCollateralLocked(uint256 amount) external onlyOwner {
        collateralLocked = amount;
        emit CollateralUpdated(collateralLocked, totalSupply());
    }

    function setMinCollateralBps(uint256 value) external onlyOwner {
        require(value >= 10_000, "below 100%");
        minCollateralBps = value;
        emit MinCollateralBpsUpdated(value);
    }

    function mint(address to, uint256 amount) external onlyMinter whenNotPaused {
        uint256 nextSupply = totalSupply() + amount;
        if (nextSupply > 0) {
            uint256 requiredCollateral = (nextSupply * minCollateralBps) / 10_000;
            if (collateralLocked < requiredCollateral) revert CollateralRatioTooLow();
        }
        _mint(to, amount);
        emit CollateralUpdated(collateralLocked, totalSupply());
    }

    function burn(uint256 amount) external whenNotPaused {
        _burn(msg.sender, amount);
        emit Redeemed(msg.sender, amount);
    }

    function emergencyPause() external onlyOwner {
        _pause();
    }

    function emergencyUnpause() external onlyOwner {
        _unpause();
    }
}
