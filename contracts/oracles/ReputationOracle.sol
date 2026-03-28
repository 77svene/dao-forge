pragma solidity ^0.8.24;

contract ReputationOracle {
    address public owner;
    bytes32 public merkleRoot;

    event RootUpdated(bytes32 indexed newRoot);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "ReputationOracle: caller is not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "ReputationOracle: new owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function updateRoot(bytes32 newRoot) public onlyOwner {
        merkleRoot = newRoot;
        emit RootUpdated(newRoot);
    }

    /**
     * @dev Verifies a Merkle proof for an agent's score leaf.
     * @param agent The agent's address.
     * @param score The agent's score (uint256).
     * @param proof The Merkle proof array.
     * @return true if the leaf is in the tree, false otherwise.
     */
    function verifyProof(address agent, uint256 score, bytes32[] calldata proof) public view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(agent, score));
        bytes32 computedRoot = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedRoot <= proofElement) {
                // Hash(current + proofElement)
                computedRoot = keccak256(abi.encodePacked(computedRoot, proofElement));
            } else {
                // Hash(proofElement + current)
                computedRoot = keccak256(abi.encodePacked(proofElement, computedRoot));
            }
        }
        return computedRoot == merkleRoot;
    }
}