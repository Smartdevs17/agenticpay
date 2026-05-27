// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStorageMigration
 * @notice Interface for contract storage migration logic.
 */
interface IStorageMigration {
    /**
     * @notice Execute the migration logic.
     * @param target The address of the contract to migrate (usually the proxy).
     */
    function migrate(address target) external;

    /**
     * @notice Verify that the migration was successful.
     * @param target The address of the migrated contract.
     * @return success True if verification passes.
     */
    function verify(address target) external view returns (bool success);

    /**
     * @notice Rollback the migration if possible.
     * @param target The address of the contract to rollback.
     */
    function rollback(address target) external;
}

/**
 * @title BaseMigration
 * @notice Abstract base contract for specific storage migrations.
 */
abstract contract BaseMigration is IStorageMigration {
    address public admin;

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    // Default verify implementation can be overridden
    function verify(address target) external view virtual override returns (bool) {
        return true; 
    }

    // Default rollback implementation (must be explicitly implemented if needed)
    function rollback(address target) external virtual override {
        revert("Rollback not implemented for this migration");
    }
}
