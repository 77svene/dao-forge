pragma solidity ^0.8.24;

interface IRegistry {
    function getQuadraticVoting() external view returns (address);
    function getTreasury() external view returns (address);
    function getGovernor() external view returns (address);
}

interface IQuadraticVoting {
    function getPower(address account) external view returns (uint256);
    function totalPower() external view returns (uint256);
}

contract Governor {
    IRegistry public immutable registry;
    uint256 public votingPeriod;
    uint256 public quorumPercentage; // basis points (1/100 of 1%)
    uint256 public timelock; // in blocks    struct Proposal {
        address[] targets;
        uint256[] values;
        string[] signatures;
        bytes[] calldatas;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 totalPowerAtSnapshot;
        bool executed;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    uint256 public proposalCount;

    event ProposalCreated(uint256 id, address proposer);
    event Voted(uint256 id, address voter, uint256 power, bool support);
    event ProposalExecuted(uint256 id);
    event QuorumNotMet(uint256 id, uint256 votes, uint256 quorum);
    event ProposalFailed(uint256 id);

    constructor(
        address _registry,
        uint256 _votingPeriod,
        uint256 _quorumPercentage,
        uint256 _timelock
    ) {
        require(_registry != address(0), "Governor: zero registry");
        registry = IRegistry(_registry);
        votingPeriod = _votingPeriod;
        quorumPercentage = _quorumPercentage;
        timelock = _timelock;
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        string[] memory signatures,
        bytes[] memory calldatas    ) external returns (uint256) {
        require(targets.length == values.length, "Governor: length mismatch");
        require(targets.length == signatures.length, "Governor: length mismatch");
        require(targets.length == calldatas.length, "Governor: length mismatch");
        require(targets.length > 0, "Governor: empty proposal");

        uint256 id = proposalCount++;
        Proposal storage p = proposals[id];
        p.targets = targets;
        p.values = values;
        p.signatures = signatures;
        p.calldatas = calldatas;
        p.startBlock = block.number;
        p.endBlock = block.number + votingPeriod;
        p.totalPowerAtSnapshot = IQuadraticVoting(registry.getQuadraticVoting()).totalPower();

        emit ProposalCreated(id, msg.sender);
        return id;
    }

    function vote(uint256 id, bool support) external {
        Proposal storage p = proposals[id];
        require(block.number >= p.startBlock && block.number <= p.endBlock, "Governor: voting period ended");
        require(!hasVoted[id][msg.sender], "Governor: already voted");

        uint256 power = IQuadraticVoting(registry.getQuadraticVoting()).getPower(msg.sender);
        require(power > 0, "Governor: zero voting power");

        if (support) {
            p.forVotes += power;
        } else {
            p.againstVotes += power;
        }
        hasVoted[id][msg.sender] = true;

        emit Voted(id, msg.sender, power, support);
    }

    function execute(uint256 id) external {
        Proposal storage p = proposals[id];
        require(!p.executed, "Governor: already executed");
        require(block.number > p.endBlock + timelock, "Governor: timelock not passed");

        uint256 quorum = (p.totalPowerAtSnapshot * quorumPercentage) / 10000;
        uint256 votes = p.forVotes + p.againstVotes;
        if (votes < quorum) {
            emit QuorumNotMet(id, votes, quorum);
            return;
        }
        if (p.forVotes < p.againstVotes) {
            emit ProposalFailed(id);
            return;
        }

        p.executed = true;
        for (uint256 i = 0; i < p.targets.length; i++) {
            (bool success, ) = p.targets[i].call{value: p.values[i]}(p.calldatas[i]);
            require(success, "Governor: call failed");
        }

        emit ProposalExecuted(id);
    }
}