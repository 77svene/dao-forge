pragma solidity ^0.8.24;

interface IRegistry {
    function getGovernor() external view returns (address);
    function getTreasury() external view returns (address);
    function getQuadraticVoting() external view returns (address);
}

interface IExecutor {
    function execute(address target, uint256 value, bytes calldata data) external returns (bool);
}

contract ProposalExecutor {
    IRegistry public immutable registry;
    uint256 public timelock; // in blocks
    mapping(uint256 => bool) public executedProposals;
    mapping(uint256 => uint256) public readyTimestamp; // proposalId -> block number when executable    event ProposalScheduled(uint256 indexed proposalId, uint256 readyAt);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event ExecutionFailed(uint256 indexed proposalId, string reason);

    constructor(address _registry, uint256 _timelock) {
        require(_registry != address(0), "ProposalExecutor: registry is zero address");
        require(_timelock > 0, "ProposalExecutor: timelock must be greater than 0");
        registry = IRegistry(_registry);
        timelock = _timelock;
    }

    // Only the Governor can schedule a proposal for execution after timelock
    function schedule(
        uint256 proposalId,
        address[] calldata targets,
        uint256[] calldata values,
        string[] calldata signatures,
        bytes[] calldata calldatas
    ) external {
        address governor = registry.getGovernor();
        require(msg.sender == governor, "ProposalExecutor: only governor can schedule");
        require(targets.length == values.length, "ProposalExecutor: length mismatch");
        require(targets.length == signatures.length, "ProposalExecutor: length mismatch");
        require(targets.length == calldatas.length, "ProposalExecutor: length mismatch");
        require(!executedProposals[proposalId], "ProposalExecutor: already executed");

        readyTimestamp[proposalId] = block.number + timelock;
        emit ProposalScheduled(proposalId, readyTimestamp[proposalId]);
    }

    // Anyone can execute after timelock has passed
    function execute(
        uint256 proposalId,
        address[] calldata targets,
        uint256[] calldata values,
        string[] calldata signatures,
        bytes[] calldata calldatas
    ) external {
        require(block.number >= readyTimestamp[proposalId], "ProposalExecutor: timelock not passed");
        require(!executedProposals[proposalId], "ProposalExecutor: already executed");
        require(targets.length == values.length, "ProposalExecutor: length mismatch");
        require(targets.length == signatures.length, "ProposalExecutor: length mismatch");
        require(targets.length == calldatas.length, "ProposalExecutor: length mismatch");

        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, bytes memory returnData) = targets[i].call{value: values[i]}(abi.encodeWithSignature(signatures[i], calldatas[i]));
            if (!success) {
                executedProposals[proposalId] = true; // Mark as executed to prevent retry
                emit ExecutionFailed(proposalId, "Call failed");
                revert("ProposalExecutor: call failed");
            }
        }

        executedProposals[proposalId] = true;
        emit ProposalExecuted(proposalId);
    }

    // Allow Governor to cancel a scheduled proposal before timelock expires    function cancel(uint256 proposalId) external {
        address governor = registry.getGovernor();
        require(msg.sender == governor, "ProposalExecutor: only governor can cancel");
        require(block.number < readyTimestamp[proposalId], "ProposalExecutor: cannot cancel after timelock");
        delete readyTimestamp[proposalId];
        emit ProposalCancelled(proposalId);
    }

    // Check if proposal is ready for execution
    function isReady(uint256 proposalId) external view returns (bool) {
        return block.number >= readyTimestamp[proposalId] && !executedProposals[proposalId];
    }

    // Get timelock remaining in blocks
    function getTimelockRemaining(uint256 proposalId) external view returns (uint256) {
        if (block.number >= readyTimestamp[proposalId]) return 0;
        return readyTimestamp[proposalId] - block.number;
    }
}