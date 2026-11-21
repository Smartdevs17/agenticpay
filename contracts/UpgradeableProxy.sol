// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UpgradeableProxy
/// @notice Transparent upgradeable proxy pattern with admin-controlled upgrades
/// @dev Uses EIP-1967 storage slots to avoid storage collisions
contract UpgradeableProxy {
    // EIP-1967 standard storage slots
    bytes32 private constant IMPLEMENTATION_SLOT = 
        bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
    bytes32 private constant ADMIN_SLOT = 
        bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);

    event Upgraded(address indexed implementation);
    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);

    error NotAdmin();
    error ZeroAddress();
    error ImplementationNotContract();

    modifier onlyAdmin() {
        if (msg.sender != _getAdmin()) revert NotAdmin();
        _;
    }

    constructor(address implementation, address admin) {
        if (implementation == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        if (!_isContract(implementation)) {
            revert ImplementationNotContract();
        }

        _setImplementation(implementation);
        _setAdmin(admin);
    }

    /// @notice Upgrade to a new implementation
    /// @param newImplementation Address of the new implementation contract
    function upgradeTo(address newImplementation) external onlyAdmin {
        if (newImplementation == address(0)) revert ZeroAddress();
        if (!_isContract(newImplementation)) revert ImplementationNotContract();

        _setImplementation(newImplementation);
        emit Upgraded(newImplementation);
    }

    /// @notice Change the admin of the proxy
    /// @param newAdmin Address of the new admin
    function changeAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();

        address previousAdmin = _getAdmin();
        _setAdmin(newAdmin);
        emit AdminChanged(previousAdmin, newAdmin);
    }

    /// @notice Get the current implementation address
    function implementation() external view returns (address) {
        return _getImplementation();
    }

    /// @notice Get the current admin address
    function admin() external view returns (address) {
        return _getAdmin();
    }

    /// @notice Fallback function delegates all calls to the implementation
    fallback() external payable {
        _delegate(_getImplementation());
    }

    /// @notice Receive function for plain ETH transfers
    receive() external payable {
        _delegate(_getImplementation());
    }

    function _delegate(address impl) internal {
        assembly {
            // Copy msg.data to memory
            calldatacopy(0, 0, calldatasize())

            // Delegate call to implementation
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)

            // Copy return data
            returndatacopy(0, 0, returndatasize())

            switch result
            case 0 {
                // Revert if call failed
                revert(0, returndatasize())
            }
            default {
                // Return if call succeeded
                return(0, returndatasize())
            }
        }
    }

    function _getImplementation() internal view returns (address impl) {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            impl := sload(slot)
        }
    }

    function _setImplementation(address newImplementation) internal {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, newImplementation)
        }
    }

    function _getAdmin() internal view returns (address adm) {
        bytes32 slot = ADMIN_SLOT;
        assembly {
            adm := sload(slot)
        }
    }

    function _setAdmin(address newAdmin) internal {
        bytes32 slot = ADMIN_SLOT;
        assembly {
            sstore(slot, newAdmin)
        }
    }

    function _isContract(address account) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }
}

/// @title ProxyAdmin
/// @notice Admin contract for managing multiple proxies
contract ProxyAdmin {
    address public owner;
    mapping(address => bool) public operators;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);

    error NotOwner();
    error NotAuthorized();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuthorized() {
        if (msg.sender != owner && !operators[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addOperator(address operator) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        operators[operator] = true;
        emit OperatorAdded(operator);
    }

    function removeOperator(address operator) external onlyOwner {
        operators[operator] = false;
        emit OperatorRemoved(operator);
    }

    function upgradeProxy(
        UpgradeableProxy proxy,
        address newImplementation
    ) external onlyAuthorized {
        proxy.upgradeTo(newImplementation);
    }

    function changeProxyAdmin(
        UpgradeableProxy proxy,
        address newAdmin
    ) external onlyOwner {
        proxy.changeAdmin(newAdmin);
    }
}
