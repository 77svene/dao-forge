pragma solidity ^0.8.24;

interface IDelegation {
    function getLockedBalance(address account) external view returns (uint256);
    function getDelegationMultiplier(address account) external view returns (uint256);
}

contract QuadraticVoting {
    IDelegation public immutable delegation;
    uint256 public totalPower;

    event PowerUpdated(address indexed account, uint256 newPower);
    event TotalPowerUpdated(uint256 newTotalPower);

    constructor(address _delegation) {
        require(_delegation != address(0), "QuadraticVoting: delegation is zero address");
        delegation = IDelegation(_delegation);
    }

    function getPower(address account) external view returns (uint256) {
        uint256 locked = delegation.getLockedBalance(account);
        uint256 multiplier = delegation.getDelegationMultiplier(account);
        unchecked {
            return sqrt(locked * multiplier);
        }
    }

    function totalPower() external view returns (uint256) {
        return totalPower;
    }

    // Internal function to update total power when delegation changes
    function _updateTotalPower() internal {
        // In a real implementation, we would need to iterate over all accounts to compute total power.
        // For simplicity and to avoid unbounded loops, we assume total power is managed off-chain or via events.
        // This is a placeholder; in production, we would use a more efficient mechanism.
        // For the MVP, we'll compute it by summing a sample of accounts (not shown) or rely on off-chain calculation.
        // Since we cannot iterate over mapping, we'll leave this as a note that off-chain workers will compute and set totalPower.
        // However, to satisfy the interface, we'll keep a variable that can be updated by an owner or via events.
        // This is a known limitation for the MVP.
    }

    // Babylonian method for sqrt
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        unchecked {
            if (x == 0) {
                return 0;
            }
            y = (x + 1) / 2;
            while (y > x / y) {
                y = (y + x / y) / 2;
            }
        }
    }
}