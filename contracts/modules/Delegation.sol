pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract Delegation {
    IERC20 public immutable governanceToken;
    uint256 public lockDuration; // in blocks
    uint256 public slashPenalty; // basis points (e.g., 500 = 5%)

    // Locked balance per account (amount of tokens locked for voting)
    mapping(address => uint256) public lockedBalance;
    // Delegation multiplier per account (set by delegatee, default 1)
    mapping(address => uint256) public delegationMultiplier;
    // Lock timestamp per account (block when lock expires)
    mapping(address => uint256) public lockTimestamp;
    // Delegatee address per account (who the delegator has delegated to)
    mapping(address => address) public delegatee;

    event Locked(address indexed delegator, uint256 amount, uint256 unlockBlock);
    event Unlocked(address indexed delegator, uint256 amount);
    event Delegated(address indexed delegator, address indexed delegatee, uint256 multiplier);
    event Slashed(address indexed delegator, uint256 amount);

    constructor(
        address _governanceToken,
        uint256 _lockDuration,
        uint256 _slashPenalty
    ) {
        require(_governanceToken != address(0), "Delegation: governance token is zero address");
        require(_lockDuration > 0, "Delegation: lock duration must be greater than 0");
        require(_slashPenalty > 0 && _slashPenalty <= 10000, "Delegation: slash penalty must be between 0 and 10000");
        governanceToken = IERC20(_governanceToken);
        lockDuration = _lockDuration;
        slashPenalty = _slashPenalty;
    }

    function lock(uint256 amount) external {
        require(amount > 0, "Delegation: must lock positive amount");
        uint256 tokenBalance = governanceToken.balanceOf(msg.sender);
        require(tokenBalance >= amount, "Delegation: insufficient token balance");

        // Transfer tokens to this contract (assuming it holds them)
        require(governanceToken.transferFrom(msg.sender, address(this), amount), "Delegation: transfer failed");

        lockedBalance[msg.sender] += amount;
        lockTimestamp[msg.sender] = block.number + lockDuration;
        emit Locked(msg.sender, amount, block.number + lockDuration);
    }

    function unlock() external {
        uint256 amount = lockedBalance[msg.sender];
        require(amount > 0, "Delegation: no locked balance to unlock");
        require(block.number >= lockTimestamp[msg.sender], "Delegation: lock period not expired");

        lockedBalance[msg.sender] = 0;
        lockTimestamp[msg.sender] = 0;
        // Transfer tokens back to user        require(governanceToken.transfer(msg.sender, amount), "Delegation: transfer failed");
        emit Unlocked(msg.sender, amount);
    }

    function delegate(address _delegatee, uint256 _multiplier) external {
        require(_delegatee != address(0), "Delegation: delegatee is zero address");
        require(_delegatee != msg.sender, "Delegation: cannot delegate to self");
        require(_multiplier > 0, "Delegation: multiplier must be positive");
        require(lockedBalance[msg.sender] > 0, "Delegation: must have locked balance to delegate");

        delegationMultiplier[msg.sender] = _multiplier;
        delegatee[msg.sender] = _delegatee;
        emit Delegated(msg.sender, _delegatee, _multiplier);
    }

    function slash(address _delegator) external {
        require(lockedBalance[_delegator] > 0, "Delegation: no locked balance to slash");
        require(block.number >= lockTimestamp[_delegator], "Delegation: lock period not expired for slashing");

        uint256 amount = lockedBalance[_delegator];
        uint256 slashAmount = (amount * slashPenalty) / 10000;
        require(slashAmount > 0, "Delegation: slash amount is zero");

        lockedBalance[_delegator] -= slashAmount;
        // Slashed tokens are burned or sent to treasury; for simplicity, we burn
        require(governanceToken.transfer(address(0), slashAmount), "Delegation: burn failed");
        emit Slashed(_delegator, slashAmount);
    }

    function getLockedBalance(address account) external view returns (uint256) {
        return lockedBalance[account];
    }

    function getDelegationMultiplier(address account) external view returns (uint256) {
        return delegationMultiplier[account];
    }

    function getDelegatee(address account) external view returns (address) {
        return delegatee[account];
    }

    function getLockTimestamp(address account) external view returns (uint256) {
        return lockTimestamp[account];
    }
}